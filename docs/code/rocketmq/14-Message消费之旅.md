# Message 消费之旅

Consumer 的启动只是消费 Message 中的一小步，核心流程是如何通过 Broker 找到我们消费的数据。



### 一、准备拉取消息

Consumer 启动流程时给大家讲过会调用这个方法：

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: PullMessageService
// 行数: 89
@Override
public void run() {
  //......
  PullRequest pullRequest = this.pullRequestQueue.take();
  this.pullMessage(pullRequest);
  //......
}
```



负责拉取消息的核心组件就是：PullMessageService。PullMessageService 启动的线程会不停地从 Broker 拉取数据：

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: PullMessageService
// 行数: 89
@Override
public void run() {
    log.info(this.getServiceName() + " service started");

    while (!this.isStopped()) {
        try {
            PullRequest pullRequest = this.pullRequestQueue.take();
            this.pullMessage(pullRequest);
        } catch (InterruptedException ignored) {
        } catch (Exception e) {
            log.error("Pull Message Service Run Method exception", e);
        }
    }

    log.info(this.getServiceName() + " service end");
}

private void pullMessage(final PullRequest pullRequest) {
    final MQConsumerInner consumer = this.mQClientFactory.selectConsumer(pullRequest.getConsumerGroup());
    if (consumer != null) {
        // 调用DefaultMQPushConsumerImpl来处理PullRequest
        DefaultMQPushConsumerImpl impl = (DefaultMQPushConsumerImpl) consumer;
        impl.pullMessage(pullRequest);
    } else {
        log.warn("No matched consumer for the PullRequest {}, drop it", pullRequest);
    }
}
```

- 这其实是一个内存队列，从 this.pullRequestQueue 中获取 PullRequest 请求，这个命名其实很贴切，就是它的字面意思，大家暂时理解为有了这个请求，才会去拉取 Message。

![image-20240605213838077](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240605213838077.png)



### 二、探索 PullRequest 的来源

既然是个内存队列，那么就肯定有 Producer 和 Consumer。Consumer 刚刚已经打过照面了，就是负责拉取消息的核心组件：PullMessageService，那 Producer 是谁？又是在什么时候生产的数据？

答案就藏在 **Rebalance** 当中。

将其来源放在 Rebalance 中，从逻辑上来讲也很好理解。因为假设 Consumer 是一个全新的实例，那么启动之后它必然会开始消费 Message，而既然要消费 Message 就只能去找大哥 PullMessageService。但大哥不是谁想找就能找到的，普通人要找大哥需要通过他的小弟，这个很符合常理对吧。

那么大哥的小弟是谁呢？答案就是 **PullRequest** 这个内存队列。

所以，如下图所示，经过了 Rebalance 之后 Consumer 分配到了 MessageQueue，那之后它就必然会去找小弟，告诉他我这里要消费 Message 了，然后给小弟塞一个 PullRequest。这样大哥才知道你这里有消费需求，然后才会分配资源给你执行后续流程。

![image-20240613222304778](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240613222304778.png)

### 三、消费 PullRequest：开始拉取消息

简单了解了 PullRequest 的起源之后，我们将视角切回到 PullMessageService 对 PullRequest 的消费上来。前面咱们介绍了 PullMessageService 是拉取消息的核心组件，但没想到吧，最最核心的实现又被它“外包”出去了。给谁了呢？给了 **DefaultMQPushConsumerImpl**，RocketMQ 对 Consumer 的默认实现之一。

```java
// 源码位置:
// 子项目
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: DefaultMQPushConsumerImpl
// 行数: 214
public void pullMessage(final PullRequest pullRequest) {
  //......
  // 拉取消息的核心调用 行数: 434
  this.pullAPIWrapper.pullKernelImpl(
    //.....
  )
}
```

- 在 `pullMessage` 当中，Consumer 会调用 Broker 提供的 API **拉取消息**。



其实大家可以看到，在 RocketMQ 中的很多操作都是异步的，向 Broker 请求数据也不例外，因为咱们不清楚 Request 什么时候会返回，为了**不阻塞后续的请求**，这里`采用异步、通过 Callback 的方式`来拉取数据，如下图所示：

![image-20240609174348631](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240609174348631.png)

- Consumer 侧会实现一个叫 PullCallBack 的回调函数，然后异步地调用 Broker 去拉取 Message，等 Broker 的 Response 返回之后，就会触发对 PullCallBack 的调用。





### 四、处理拉取消息结果：执行 PullCallBack

由于 Request 有可能成功、也有可能失败，所以 PullCallback 也针对不同的 Response 做了判断处理，其处理逻辑分为了两部分，如下图所示：

![image-20240609175407505](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240609175407505.png)

- **onSuccess**，拉取到了消息之后的逻辑；
- **onException**，拉取消息发生异常之后的处理逻辑。



源码如下：

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: DefaultMQPushConsumerImpl
// 行数: 309
PullCallback pullCallback = new PullCallback() {
  @Override
  public void onSuccess(PullResult pullResult) {
    //......
  }

  @Override
  public void onException(Throwable e) {
    //......
  }
};
```

值得我们注意的是，这里的回调**不仅仅是处理请求就完了**，它还有另一个很重要的作用。是啥呢？我们先回顾一下 PullRequest 的生成规则。

如果在 Rebalance 之后分配到新的 MessageQueue，Consumer 就会为其生成一个 PullRequest。这个条件其实是比较苛刻的，大部分 Rebalance 后的结果是不变的。那么一旦内存队列中将刚刚生成的 PullRequest 消费掉，既然 PullRequest 没了，那 Consumer 后续应该如何消费呢？

从结果反推实现，我们知道 Consumer 一定是可以持续地消费 Message 的，而消费消息需要通过 PullRequest，那么必然有地方在持续不断地生成 PullRequest。

这个地方就是 PullCallBack，这就是它另一个作用：

![image-20240609180344345](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240609180344345.png)

- 无论是成功还是失败，PullCallBack 都会为下次拉取 Message 生成一个 PullRequest，这个无限套娃的循环才能源源不断地消费 Message；
- 大家在 PullCallBack 当中能够看到 `executePullRequestImmediately()` 或者 `executePullRequestLater()` 这样的调用，无论是立即调用还是等会调用，底层都是调用的 `executePullRequestImmediately()`

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: PullMessageService
// 行数: 59
public void executePullRequestImmediately(final PullRequest pullRequest) {
  try {
    this.pullRequestQueue.put(pullRequest);
  } catch (InterruptedException e) {
    log.error("executePullRequestImmediately pullRequestQueue.put", e);
  }
}
```

- 本质上就是往内存队列当中生产 PullRequest。



### 五、对于拉取 Message 的成功处理

异常情况其实没有什么好深入了解的，例如 Broker 实例有点问题、网络有点问题之类的，这里直接重试就好了。我们来深入了解处理成功的情况，这才是核心逻辑所在的地方。

对于成功，在 PullCallback 当中也对应着 4 种不同的状态，分别是：`FOUND`、`NO_NEW_MSG`、`NO_MATCHED_MSG`、`OFFSET_ILLEGAL`。可以看到这里其实也有处理异常 case 的情况，有同学可能有疑问，这不是在处理拉取成功的消息吗？咋又开始处理起异常了？

这其实跟开发一些 Web 应用的做法类似，虽然返给前端的 HTTP 状态码是 200，但这只是代表 **HTTP 请求本身是成功的**。实际上在业务内可能会发生各种各样的异常，例如参数传错了、当前的状态不能支持该操作，等等。所以，一般来说在业务上还会添加一个参数 `success` 来代表请求在**业务上是否成功**。

一旦判断拉取消息成功，被拉取到的 Message 就会被写入到 **ProcessQueue** 当中。





### 六、ProcessQueue：存储拉取到的 Message

ProcessQueue 可以简单地理解为某个 MessageQueue 的**消费快照**。

PullRequest 消费一次之后就没了，总得有个地方来存储刚刚 PullRequest 拉取到的数据吧？那 ProcessQueue 当中存储了 Message 的数量、Message 的大小、以及所有 Message 的详细信息：

```java
// 源码位置:
// 子项目: client
// 包名: org.apache.rocketmq.client.impl.consumer;
// 文件: ProcessQueue
// 行数: 43
public class ProcessQueue {
  //......
  private final TreeMap<Long, MessageExt> msgTreeMap = new TreeMap<Long, MessageExt>();
  private final AtomicLong msgCount = new AtomicLong();
  private final AtomicLong msgSize = new AtomicLong();
  //......
}
```

- Consumer 会有一个 Map 在专门维护 MessageQueue 和 ProcessQueue 的关联关系，因为 PullRequest 是根据 MessageQueue 生成的，所以 ProcessQueue 当中存储的数据也是和某个具体的 MessageQueue 相关联的；
- 在 Rebalance 后，如果分配到的新的 MessageQueue 就会同时生成 ProcessQueue 和 PullRequest。在 PullCallBack 处理的时候，如果发现从 Broker 拉取到了数据，就会将其写入到此 MessageQueue 对应 ProcessQueue 当中；

![image-20240609184658715](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240609184658715.png)

- 在 ProcessQueue 内部会使用一颗红黑树来存储暂时没有被消费的 Message，TreeMap 其实是一个用红黑树实现的有序的 Map。Key 是消息在当前 ProcessQueue 所对应的 MessageQueue 中的偏移量，value 则是 Message 自身；



在存入 ProcessQueue 成功之后，Consumer 就会开始消费这些 Message。怎么消费呢？通过线程池并发地调用在初始化 Consumer 时我们传入的 Listener，也就是这个：

![image-20240609184920810](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240609184920810.png)

这里应该就是大家平时使用消息队列当中使用最频繁的地方了，在 Listener 当中我们会写收到 Message 之后才执行的相关逻辑。



### 七、总结

至此，Message 到达了它的终点站：Consumer，并且被成功消费了。

通过本章节的学习，我们知道了如果 Consumer 要拉取消息，则必须要持有“凭证”：`PullRequest`，并且这个 PullRequest 是在 Rebalance 之后、分配到了新的 MessageQueue 才生成的。一个 PullRequest 和一个 MessageQueue 可以理解为是**一一对应**的关系。这个在我们了解 ConsumeQueue 索引文件的组成结构之后其实很好理解，索引的组织也是 By MessageQueue 来进行的。

我们也完成了一次“完整的网购流程”：从下单快递（Message）被发出，再到经过运输到达快递驿站，再到我们通过取货码拿到货物。Message 从被构建出来、再到发送给 Broker 并最被 Consumer 消费，整个过程形成了流程上的闭环。
