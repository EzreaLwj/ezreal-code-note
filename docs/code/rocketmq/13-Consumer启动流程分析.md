# Consumer 启动流程分析



其实 Consumer 的启动流程与 Producer 如出一辙。

```java
public class DefaultMQPushConsumer extends ClientConfig implements MQPushConsumer {
    @Override
    public void start() throws MQClientException {
        setConsumerGroup(NamespaceUtil.wrapNamespace(this.getNamespace(), this.consumerGroup));
        this.defaultMQPushConsumerImpl.start();
        if (null != traceDispatcher) {
            try {
                traceDispatcher.start(this.getNamesrvAddr(), this.getAccessChannel());
            } catch (MQClientException e) {
                log.warn("trace dispatcher start failed ", e);
            }
        }
    }
}
```

- Consumer 的实现类是 DefaultMQPushConsumer



## 一、检验参数

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: DefaultMQPushConsumerImpl
// 行数: 661
private void checkConfig() throws MQClientException {
  //......省略
}
```



以下是主要的检查项：

- **ConsumerGroupName 是否合法**。比如，是不是空的？传入的名称有没有超过规定的最大长度？有没有包含非法字符？这部分检查跟 Topic 名称那块的检查逻辑如出一辙。
- **ConsumerGroupName 名称是否是 RocketMQ 内置的名称**。这个概念其实跟编程语言中的保留字类似，这个很容易理解，就比如咱们写 Java，`for` 这个名字被 Java 当做了**关键字**，所以咱们不能再将变量命名成 `for` 了。
- **检查 MessageModel 是否指定**。这个会有默认值，是 `CLUSTERING`
- **检查 ConsumeFromWhere 是否指定**。它告诉 Broker 当前这个 Consumer 需要从什么地方开始消费 Message。
- **设置的 ConsumeTimestamp 是否合法**。这也是 RocketMQ 高级特性之一，即消息回溯。可以从指定的时间开始重新消费 Message。
- **是否设置了监听消息的 Listener**。如果这个都没有，你说你还消费个啥。





## 二、生成 MQClientInstance 

Producer 和 Consumer 都会依赖这个实例，其实可以大致理解为 MQClientInstance 集成了两者较为共性的功能。并且 MQClientInstance 会通过其中维护的数据来巧妙地区分当前实例的所属角色，例如咱们之前讲过的 `producerTable` 和 `consumerTable`。



## 三、初始化 Rebalancelmpl

什么是 Rebalance。这里简单举一个例子：假设咱们之前创建的 Topic 有 8 个 MessageQueue，然后同一个 ConsumerGroup 下有 2 个 Consumer 实例在消费消息，假设每个 Consumer 会被分配到 4 个 MessageQueue。

Consumer 按照当前分配的 MessageQueue 运行得好好的，突然后续又新加入了 2 个消费者，此时总共会有 4 个消费者，但 MessageQueue 已经被之前的 2 个消费者给占完了。**新加入的要如何获取到 MessageQueue？获取到哪个 MessageQueue？或者说获取到多少个 MessageQueue？**

这就是 RebalanceImpl 要解决的问题：对 MessageQueue 资源的重平衡，这里会启动一个 Rebalance 线程，每隔 20s 执行一次。

```java
this.rebalanceImpl.setConsumerGroup(this.defaultMQPushConsumer.getConsumerGroup());
this.rebalanceImpl.setMessageModel(this.defaultMQPushConsumer.getMessageModel());
this.rebalanceImpl.setAllocateMessageQueueStrategy(this.defaultMQPushConsumer.getAllocateMessageQueueStrategy());
this.rebalanceImpl.setmQClientFactory(this.mQClientFactory);
```



## 四、初始化拉取消息的核心组件

负责拉取消息核心组件是 PullAPIWrapper，在 Consumer 启动阶段，会调用其构造函数将其实例化出来：

![image-20240605160603222](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240605160603222.png)



代码如下：

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: DefaultMQPushConsumerImpl
// 行数: 597
this.pullAPIWrapper = new PullAPIWrapper(
  mQClientFactory,
  this.defaultMQPushConsumer.getConsumerGroup(), isUnitMode());
```

- 消息拉取有两种方式：Consumer 主动拉，Broker 主动推，但是 PullConsumer 的 start 方法中，无论是推还是拉，底层实现都是 PullAPIWrapper。



## 五、确定使用的 OffsetStore

OffsetStore 是用于记录当前消费者消费进度的一个组件。当 **Consumer 因为某些原因中断了正常的消费**，当它再次重启之后怎么知道该从哪里继续消费呢？OffsetStore 会帮助我们确定。

OffsetStore **有两种实现**：

- LoadFileOffsetStore：将消费进度存储在 Consumer 本地，Consumer 会在磁盘上生成文件以保存进度；
- RemoteBrokerOffsetStore：将消费进度保存在远端的 Broker。

至于 OffsetStore 具体会选择哪个，则是由另一个变量 **MessageModel** 来确定的，如下面的代码所示：

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: DefaultMQPushConsumerImpl
// 行数: 605
switch (this.defaultMQPushConsumer.getMessageModel()) {
   case BROADCASTING:
     this.offsetStore = new LocalFileOffsetStore(this.mQClientFactory, this.defaultMQPushConsumer.getConsumerGroup());
     break;
   case CLUSTERING:
     this.offsetStore = new RemoteBrokerOffsetStore(this.mQClientFactory, this.defaultMQPushConsumer.getConsumerGroup());
     break;
   default:
     break;
 }
```

现在详细说一说 MessageModel 字段，简单来说，MessageModel **确定了 Broker 分发 Message 的方式**，总共有两种 `BROADCASTING` **广播消费**和 `CLUSTERING`**集群消费**。RocketMQ 默认是 CLUSTERING 集群消费。



假设咱们的某个消费者组有 3 个实例，并且当前的 MessageModel 是 `BROADCASTING` （代表广播的意思），那么 Message 会**被每一个实例消费到**，如下图所示：

![image-20240605170857726](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240605170857726.png)

- 同一条 Message 会被 Consumer 1、2、3 都消费一次，换句话说同一条 Message 都会被重复处理 3 次，这就是所谓的 `BROADCASTING`。大家就可以理解为你关注的某个 UP 主有了新的动态，那么其他订阅该 UP 主的人也同样会收到。

而 `CLUSTERING` 会把一个 ConsumerGroup 中的所有 Consumer 当作一个**整体**，ID 为 100 的 Message 只会被 ConsumerGroup 中的一个 Consumer 消费一次。

![image-20240605174935289](C:\Users\Ezreal\AppData\Roaming\Typora\typora-user-images\image-20240605174935289.png)



## 六、确定消费模式

接下来会通过 Consumer 初始化时注册的 Listener 类型来确定消费的模式。

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: DefaultMQPushConsumerImpl
// 行数: 619
if (this.getMessageListenerInner() instanceof MessageListenerOrderly) {
  this.consumeOrderly = true;
  this.consumeMessageService =
    new ConsumeMessageOrderlyService(this, (MessageListenerOrderly) this.getMessageListenerInner());
} else if (this.getMessageListenerInner() instanceof MessageListenerConcurrently) {
  this.consumeOrderly = false;
  this.consumeMessageService =
    new ConsumeMessageConcurrentlyService(this, (MessageListenerConcurrently) this.getMessageListenerInner());
}
```

这里会通过 `instanceof` 来判断左侧 Consumer 指定的 Listener 是否是右侧类的**实例**，以此来确认是采用**顺序消费**还是**并发消费**，以及消费消息的组件采用的实现，**ConsumerMessageService** 里有消费消息的详细实现。



## 七、注册 Consumer

此步骤和 Producer 做的是一样的，将自己注册到内部依赖的 MQClientInstance 中。`不一样`的是，Producer 是注册到 Producer Table 里，而 Consumer 是注册到 **ConsumerTable** 中。

这块其实没有什么好说的，注册到 ConsumerTable 中其实就变相地把自己标识为 Consumer 了。



## 八、调用 MQClientInstance 的 start 方法

大家应该记得，Producer 在启动时也调用了 MQClientInstance 的 `start()` 方法。

既然调用的是同一个方法，那么自然做的操作也一致，比如启动用于通信的 Channel，启动一大堆的定时任务等。例如，定时获取 NameServer 的地址，清理无效、下线的 Broker，持久化 Offset，等等，这里也会做一样的操作，这些就不在此赘述。

不过这里会启动两个跟 Consumer 相关的服务，分别是 **PullMessageService** 和 **RebalanceService**，一个负责**拉取 Message**，另一个负责**对 Consumer 的 Rebalance**，即**重平衡**。



## 九、立即发送一次心跳

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: DefaultMQPushConsumerImpl
// 行数: 657
this.mQClientFactory.sendHeartbeatToAllBrokerWithLock();
```

接下来会立即给所有的 Broker 发送一次心跳。

这里可能会有同学有疑问，之前在 MQClientInstance `start()` 的**启动定时任务**环节不是已经发送了心跳吗？怎么这里还要发心跳？是不是忘记删除代码了？**当然不是！**MQClientInstance 中启动的只是**定时任务**，以保证后续持续地发送心跳。并且它有个参数叫 `initialDelay`，代表首次延迟执行的时间，这里给的是 1000ms，即 1 秒。所以，如果不**立即**发送一次心跳，那么 Consumer 上线，再到 Broker 感知到它就会有 1 秒的延迟。



## 十、立即执行一次 Rebalance

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: DefaultMQPushConsumerImpl
// 行数: 658
this.mQClientFactory.rebalanceImmediately();
```

为什么 Consumer 在启动时要立即 Rebalance 一次呢？

其实这个道理很好理解，因为无论当前这个 Consumer 是之前已经有消费记录的实例，还是一个全新的实例，它的加入都会打**破原有的 MessageQueue 分配**。

就好像现在总共有 6 个瓜，张三、李四一个人分到了 3 个，但现在突然冒出来个王五，那么就需要进行 Rebalance，将其 Rebalance 成张三、李四、王五每人分到 2 个瓜，然后大家一起吃瓜。

同理，如果此时不进行 Rebalance，那么新加入的消费者组将**不会消费到任何消息**，因为根本没有 MessageQueue 分配给它。
