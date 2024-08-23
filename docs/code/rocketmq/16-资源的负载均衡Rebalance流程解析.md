# 资源的负载均衡——Rebalance流程解析



## 一、背景

刚开始时，有 2 个 Consumer 各自分配了 3 个 MessageQueue 在进行正常消费，后续同一个 ConsumerGroup 加入了新的 Consumer，如果不给新的 Consumer 分配 MessageQueue，那么它将无法消费消息，这就是为什么需要 Rebalance 的原因，Rebalance 也是本章探究的重点。



## 二、Consumer 触发的 Rebalance 的时机

在 Consumer 启动的时候就会触发一次 Rebalance，除此之外，还会启动一个线程，每隔 20s 就会执行一次 Rebalance，所以接下来让我们探索在 Consumer 启动时是如何具体执行 Rebalance 的。

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: DefaultMQPushConsumerImpl
// 行数: 658
this.mQClientFactory.rebalanceImmediately();
```

- 在 Consumer 启动时默认触发一次 Rebalance；

- 这里会让 Consumer **立即**执行一次 Rebalance，那么作为一个客户端，它在这个流程中具体都会做哪些事呢？让我们继续往下看。



```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.factory;
// 文件: MQClientInstance
// 行数: 954
public void doRebalance() {
  for (Map.Entry<String, MQConsumerInner> entry : this.consumerTable.entrySet()) {
    MQConsumerInner impl = entry.getValue();
    if (impl != null) {
      try {
        // 每个Consumer执行doRebalance
        impl.doRebalance();
      } catch (Throwable e) {
        log.error("doRebalance exception", e);
      }
    }
  }
}
```

可以看到，这部分逻辑是封装在 MQClientInstance 中，这其中是封装 Consumer 和 Producer 的一些共性操作，但这里的 Rebalance 只是针对 Consumer。操作过程如下图：

![image-20240615121826635](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240615121826635.png)

核心的逻辑在 `impl.doRebalance()` 当中，所以我们还需要继续跟着往下走，代码如下：

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: RebalanceImpl
// 行数: 217
public void doRebalance(final boolean isOrder) {
    Map<String, SubscriptionData> subTable = this.getSubscriptionInner();
    if (subTable != null) {
        for (final Map.Entry<String, SubscriptionData> entry : subTable.entrySet()) {
            final String topic = entry.getKey();
            try {
                //执行Rebalance操作
                this.rebalanceByTopic(topic, isOrder);
            } catch (Throwable e) {
                if (!topic.startsWith(MixAll.RETRY_GROUP_TOPIC_PREFIX)) {
                    log.warn("rebalanceByTopic Exception", e);
                }
            }
        }
    }

    this.truncateMessageQueueNotMyTopic();
}
```

- 其中 subTable 是一个 Map，key 为 Topic 的名称，Value 是 Topic 订阅的相关数据；
- 这里会通过 `this.rebalanceByTopic(topic, isOrder)` 来一个 Topic 一个 Topic 地执行 Rebalance，所以大概的流程是：先找到所有的 Consumer，然后通过 Consumer 找到其订阅的 Topic，然后对这些 Topic 进行 Rebalance 操作。



## 三、为每个 Topic 执行 Rebalance



### 3.1 获取 Topic 下的所有 MessageQueue

Rebalance 的操作其实是对资源的重平衡，资源其实就是 **MessageQueue**，所以首先要做的事是获取该 Topic 下所有的 MessageQueue：

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: RebalanceImpl
// 行数: 259
private void rebalanceByTopic(final String topic, final boolean isOrder) {
    switch (messageModel) {
        case CLUSTERING: {
            // 获取 Topic 下的 MessageQueue
            Set<MessageQueue> mqSet = this.topicSubscribeInfoTable.get(topic);
            List<String> cidAll = this.mQClientFactory.findConsumerIdList(topic, consumerGroup);
            //...
        }
    }
}
```

- 可以看到，是从 topicSubscribeInfoTable 这个 Map 中获取的，key 是 Topic 的名称，value 是 MessageQueue 集合；



### 3.2 获取 Topic 下的所有 Consumer

上面我们讲到了资源重分配当中的资源，资源自然是分给 Consumer，Consumer 分配到了 MessageQueue，才能创建 PullRequest，进而才能开始拉取 Message。

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: RebalanceImpl
// 行数: 260
List<String> cidAll = this.mQClientFactory.findConsumerIdList(topic, consumerGroup);
```



Consumer 会通过内部的 MQClientInstance 组件对 Broker 发起请求，该 RequestCode 是 `GET_CONSUMER_LIST_BY_GROUP`，代表通过 ConsumerGroup 的名称获取到所有的 Consumer，下面是 Broker 端的处理逻辑：

```java
public RemotingCommand getConsumerListByGroup(ChannelHandlerContext ctx, RemotingCommand request)
    throws RemotingCommandException {

    ConsumerGroupInfo consumerGroupInfo =
        this.brokerController.getConsumerManager().getConsumerGroupInfo(
            requestHeader.getConsumerGroup());
    if (consumerGroupInfo != null) {
        List<String> clientIds = consumerGroupInfo.getAllClientId();
        if (!clientIds.isEmpty()) {
            GetConsumerListByGroupResponseBody body = new GetConsumerListByGroupResponseBody();
            body.setConsumerIdList(clientIds);
            response.setBody(body.encode());
            response.setCode(ResponseCode.SUCCESS);
            response.setRemark(null);
            return response;
        } 
    } 
}
```

- Broker 收到请求之后会从专门管理 Consumer 的组件 **ConsumerManager** 当中获取当前 ConsumerGroup 下的所有的 Consumer 实例，而 ConsumerManager 中核心存储数据的地方就是 `consumerTable`，它也是个 Map。
- 代码当中的 cidAll 其实是当前 Topic 正在消费的所有 Consumer 的 ClientId



### 3.3 对结果进行排序

接下来，Consumer 会对它拿到的 MessageQueue 和 Consumer 进行排序

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: RebalanceImpl
// 行数: 275
Collections.sort(mqAll);
Collections.sort(cidAll);
```

首先我们需要明白一件事，Rebalance 是在客户端执行的，它不是由 Broker 来统一执行的，那么既然是在客户端执行，如果此时消费者组里面有 10 个 Consumer，如何保证这 10 个 Consumer 客户端分别执行 Rebalance 逻辑、并拿到互不相同的 MessageQueue 呢？

![image-20240615155959452](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240615155959452.png)

这就需要了解具体的分配策略了。



### 3.4 确认分配策略

在我们调用 Consumer 的构造函数时，RocketMQ 就为我们指定了默认的分配算法：

```java
// 源码位置:
// 子项目: example
// 包名: org.apache.rocketmq.example.simple;
// 文件: PushConsumer
// 行数: 31
DefaultMQPushConsumer consumer = new DefaultMQPushConsumer("CID_JODIE_1");

// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.consumer;
// 文件: DefaultMQPushConsumer
// 行数: 280
public DefaultMQPushConsumer(final String consumerGroup) {
  this(null, consumerGroup, null, new AllocateMessageQueueAveragely());
}
```

- 上面代码中的 `new AllocateMessageQueueAveragely()` 就是为我们默认指定的分配策略，即**平均哈希队列算法**。其内部的实现远远没有给几个人分饮料那么简单，我们继续往下看。



### 3.5 执行资源分配

在执行 Rebalance 时就会直接执行对应的分配策略所对应的逻辑，关键代码如下：

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: RebalanceImpl
// 行数: 278
AllocateMessageQueueStrategy strategy = this.allocateMessageQueueStrategy;

List<MessageQueue> allocateResult = null;
try {
    // 执行分配的具体逻辑
    allocateResult = strategy.allocate(
        this.consumerGroup,
        this.mQClientFactory.getClientId(),
        mqAll,
        cidAll);
} 
```

- 可见是通过 allocate 方法来执行进行资源分配，参数有 consumerGroup 的名称，当前客户端的 clientId，MessageQueue 列表和所有客户端 Id 列表；

- 所有客户端都会执行这个方法，只有当前客户端的 clientId 是不同的，这也是不同客户端在运行 Rebalance 后能拿到不同的 Mess啊 的关键所在；

接下来让我们从源码层面探索一下其具体实现，代码如下：

```java
public class AllocateMessageQueueAveragely extends AbstractAllocateMessageQueueStrategy {

    @Override
    public List<MessageQueue> allocate(String consumerGroup, String currentCID, List<MessageQueue> mqAll,
        List<String> cidAll) {

        List<MessageQueue> result = new ArrayList<MessageQueue>();
        if (!check(consumerGroup, currentCID, mqAll, cidAll)) {
            return result;
        }

        int index = cidAll.indexOf(currentCID);
        int mod = mqAll.size() % cidAll.size();
        int averageSize =
            mqAll.size() <= cidAll.size() ? 1 : (mod > 0 && index < mod ? mqAll.size() / cidAll.size()
                + 1 : mqAll.size() / cidAll.size());
        int startIndex = (mod > 0 && index < mod) ? index * averageSize : index * averageSize + mod;
        int range = Math.min(averageSize, mqAll.size() - startIndex);
        for (int i = 0; i < range; i++) {
            result.add(mqAll.get((startIndex + i) % mqAll.size()));
        }
        return result;
    }

    @Override
    public String getName() {
        return "AVG";
    }
}
```

- 可以看到这里有针对几个关键变量 `index`、`mod`、`averageSize`、`startIndex`、`range` 的计算逻辑，代码实现相当复杂。

我们通过结果反推的方式来理解这部分代码。

我们从最下面来看，`range` 代表当前**这个 Consumer 获取到了多少个 MessageQueue**，而 `for` 循环当中的 `startIndex` 代表了当前这个 Consumer 从 MessageQueue 数组的哪个位置开始取。举个例子，假设有 **4 个** MessageQueue，**2 个** Consumer，并且在经过排序之后，当前新启动的 Consumer 在数组中的下标是 1，即第 2 个元素，那么计算的情况就是这样：

![image-20240615161552275](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240615161552275.png)

- 经过计算，`range` 为 2，代表图中的 Consumer2 **最终**被分配到了 2 个 MessageQueue。`startIndex` 代表从保存所有 MessageQueue 的列表的数组下标 2 开始取，取 `range` 即 2 个。

当然，这是非常理想的情况，能够均分。那如果不能均分会发生什么呢？假设我们有 7 个 MessageQueue，2 个 Consumer，并且当前的 Consumer 启动后仍然处于 `cidAll` 当中的第二个元素的位置，会发生什么呢？如下图所示：

![image-20240615161756689](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240615161756689.png)

此时计算后的 `range` 为 **3**，代表 Consumer2 分配到了 3 个 MessageQueue，`startIndex` 为 4，代表从 MessageQueue 数组的下标 4 开始取。而 Consumer 1 此时就会得到 4 个 MessageQueue。

所以该策略分配的**逻辑**是：**能均分就均分，不能均分就先保证所有的 Consumer 都获取到等量的 MessageQueue，然后再将剩下的从头开始分给每个 Consumer。**

比如刚刚的 7 个 MessageQueue 分给 2 个 Consuemr，我们可以抽象地理解成：每个 Consumer 先分 3 个，然后剩下的 1 个按照 `cidAll` 中的顺序开始分，自然是分给排在第一位的 Consumer1 了。不过这里需要注意的是，实际上并没有先均分、再分配剩余的逻辑，上面那套复杂的计算逻辑会直接一把梭地计算到位，这里这么说只是为了方便大家理解。



### 3.6 执行 Rebalance 的时机

除了咱们刚刚讨论过的在 Consumer 启动时会立即进行一次 Rebalance，并且会注册一个定时任务每隔 20s 就周期性地执行一次 Rebalance 之外，还有一个地方会触发各个 Consumer 执行 Rebalance：Broker。

Consumer 在启动时会启动一个定时任务，每隔 30 秒向 Broker 发送心跳，代码如下：

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.factory;
// 文件: MQClientInstance
// 行数: 283
this.scheduledExecutorService.scheduleAtFixedRate(new Runnable() {
  public void run() {
    try {
      MQClientInstance.this.cleanOfflineBroker();
      // 向所有 Broker 发送心跳
      MQClientInstance.this.sendHeartbeatToAllBrokerWithLock();
    }
    //......
  }
}, 1000, this.clientConfig.getHeartbeatBrokerInterval(), TimeUnit.MILLISECONDS);
```

- 可以看到这个还是封装到 MQClientInstance 当中的方法，这说明 **Producer 也会执行相同的逻辑**。

大家可以在本地的项目中进入到 `sendHeartbeatToAllBrokerWithLock()` 当中看看具体的逻辑。里面会向 Broker 发送一个 RequestCode 为 `HEART_BEAT` 的请求，Broker 处理的逻辑在这里：

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.broker.processor;
// 文件: ClientManageProcessor
// 行数: 75
public RemotingCommand heartBeat(ChannelHandlerContext ctx, RemotingCommand request) {
  //......
}
```

本质上这里的逻辑就是将 Consumer 的信息写入到 Broker 的 **ConsumerManager** 当中，为当前的负载均衡提供**元数据**，然后 Broker 在处理请求时，如果发现有新加入的 Consumer，就会通知所有的 Consumer 执行 Rebalance，核心的代码如下：

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.broker.client;
// 文件: ConsumerManager
// 行数: 116
this.consumerIdsChangeListener.handle(ConsumerGroupEvent.CHANGE, group, consumerGroupInfo.getAllChannel());

// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.broker.client;
// 文件: DefaultConsumerIdsChangeListener
// 行数: 45
if (channels != null && brokerController.getBrokerConfig().isNotifyConsumerIdsChangedEnable()) {
  for (Channel chl : channels) {
    this.brokerController.getBroker2Client().notifyConsumerIdsChanged(chl, group);
  }
}
```

上面的 channel 就可以理解为一个 Consumer，这里 Broker 会向当前 Topic 下的**所有** Consumer 发送一个 RequestCode 为 `NOTIFY_CONSUMER_IDS_CHANGED` 的请求，收到请求的 Consumer 会执行 Rebalance 的相关逻辑：

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl;
// 文件: ClientRemotingProcessor
// 行数: 135
public RemotingCommand notifyConsumerIdsChanged(ChannelHandlerContext ctx,
                                                RemotingCommand request) throws RemotingCommandException {
  //......
  this.mqClientFactory.rebalanceImmediately();
  //......
}
```





## 四、对 Rebalance 的思考

现在我们知道了 Rebalance 的详细逻辑，接下来我们可以思考一些问题了。在前面的章节中我们聊过，在极端情况下可能会出现不同的 Consumer 拥有相同 `clientId` 的情况，如果相同会发生什么呢？

大家可以再看看上面讲的 `allocate()` 的详细实现，关键的地方如下：

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.consumer.rebalance;
// 文件: AllocateMessageQueueAveragely
// 行数: 37
int index = cidAll.indexOf(currentCID);
```

这里拿到的 index 是不同客户端各自拿到不同的 MessageQueue 的核心所在，如果两个 Consumer 的 ClientId 相同，就会出现两个客户端计算拿到的 index 是相同的，index 相同，进而导致最终计算的 stratIndex 是相同的，最终就会**导致两个 Consumer 拿到了相同的 MessageQueue**。

![image-20240615165451471](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240615165451471.png)

Consumer 1 和 2 都在消费上面两个 MessageQueue，而下面两个 MessageQueue 没有任何消费者在消费，但 Producer 却在**持续不断地写入**，而这导致的结果就是我们听到的：“XXX，线上**消息队列堆积**了，赶紧看看咋回事。“



## 五、总结

Rebalance 的细节我们已经讨论完了，我们知道有两个地方可以触发 Rebalance，一个是 Consumer，另一个是 Broker。Consumer 在启动的时候会触发一次 Rebalance，然后开启一个定时任务，每隔 2s 执行一次 Rebalance。而 Broker 则是在收到心跳、判断有新的 Consumer 加入时，会向当前 ConsumerGroup 下所有 Consumer 实例发送请求，要求它们重新执行 Rebalance。
