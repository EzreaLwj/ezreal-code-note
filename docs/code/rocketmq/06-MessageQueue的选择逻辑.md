# MessageQueue 的选择逻辑



## 一、背景

在投递 Message 之前，Producer 会通过 NameServer 拿到对应 Topic 的详细数据 TopicPublishInfo，其中包含了该 Topic 下的所有 MessageQueue。前面我们只知道会从这些 MessageQueue 当中选一个出来，这章就会告诉我们怎么选出指定的 MessageQueue。



## 二、选择 MessageQueue 源码分析

选择的入口是 DefaultMQProducerImpl 的 selectOneMessageQueue 方法

```java
public MessageQueue selectOneMessageQueue(final TopicPublishInfo tpInfo, final String lastBrokerName) {
    return this.mqFaultStrategy.selectOneMessageQueue(tpInfo, lastBrokerName);
}
```



接着就是调用 MQFaultStrategy 的 selectOneMessageQueue 方法

```java
public MessageQueue selectOneMessageQueue(final TopicPublishInfo tpInfo, final String lastBrokerName) {
    //这个参数默认是false
    if (this.sendLatencyFaultEnable) {
        try {
            int index = tpInfo.getSendWhichQueue().getAndIncrement();
            for (int i = 0; i < tpInfo.getMessageQueueList().size(); i++) {
                int pos = Math.abs(index++) % tpInfo.getMessageQueueList().size();
                if (pos < 0)
                    pos = 0;
                MessageQueue mq = tpInfo.getMessageQueueList().get(pos);
                if (latencyFaultTolerance.isAvailable(mq.getBrokerName()))
                    return mq;
            }

            final String notBestBroker = latencyFaultTolerance.pickOneAtLeast();
            int writeQueueNums = tpInfo.getQueueIdByBroker(notBestBroker);
            if (writeQueueNums > 0) {
                final MessageQueue mq = tpInfo.selectOneMessageQueue();
                if (notBestBroker != null) {
                    mq.setBrokerName(notBestBroker);
                    mq.setQueueId(tpInfo.getSendWhichQueue().getAndIncrement() % writeQueueNums);
                }
                return mq;
            } else {
                latencyFaultTolerance.remove(notBestBroker);
            }
        } catch (Exception e) {
            log.error("Error occurred when selecting message queue", e);
        }

        return tpInfo.selectOneMessageQueue();
    }
	//调用selectOneMessageQueue方法
    return tpInfo.selectOneMessageQueue(lastBrokerName);
}
```

- 整体逻辑被 sendLatencyFaultEnable 变量分成了凉拌，不过 sendLatencyFaultEnable 的默认值为 false，默认不会走这个逻辑，只会调用 TopicPublishInfo 类的  tpInfo.selectOneMessageQueue(lastBrokerName) 方法。



```java
public MessageQueue selectOneMessageQueue(final String lastBrokerName) {
    if (lastBrokerName == null) {
        //如果为空，即是第一次选择，
        return selectOneMessageQueue();
    } else {
        //不为空，表示要进行消息重投，要遍历messageQueueList.size()次
        for (int i = 0; i < this.messageQueueList.size(); i++) {
            int index = this.sendWhichQueue.getAndIncrement();
            int pos = Math.abs(index) % this.messageQueueList.size();
            if (pos < 0)
                pos = 0;
            MessageQueue mq = this.messageQueueList.get(pos);
            //如果等于不等于上一次的BrokerName才会进行返回
            if (!mq.getBrokerName().equals(lastBrokerName)) {
                return mq;
            }
        }
        return selectOneMessageQueue();
    }
}
public MessageQueue selectOneMessageQueue() {
    int index = this.sendWhichQueue.getAndIncrement();
    //随机数取余获取索引值
    int pos = Math.abs(index) % this.messageQueueList.size();
    if (pos < 0)
        pos = 0;
    return this.messageQueueList.get(pos);
}
```

- 可以看到这里的逻辑被 lastBrokerName 分成了两部分，这个 lastBrokerName 代表上次选择的 MessageQueue 所在的 Broker，并且它只会在第一次投递失败之后的后续重试流程中有值。
- selectOneMessageQueue 方法就是最终选择 MessageQueue 的方法，它通过**生成随机数取余**的方式来选择 MessageQueue；



在 DefaultMQProducerImpl 类中的 sendDefaultImpl 方法中，我们可以看到 lastBrokerName 传入的值

```java
 if (topicPublishInfo != null && topicPublishInfo.ok()) {
    MessageQueue mq = null;
    int timesTotal = communicationMode == CommunicationMode.SYNC ? 1 + this.defaultMQProducer.getRetryTimesWhenSendFailed() : 1;
    int times = 0;
    for (; times < timesTotal; times++) {
        //根据mq的值写入BrokerName
        String lastBrokerName = null == mq ? null : mq.getBrokerName();
        //进行MessageQueue选择
        MessageQueue mqSelected = this.selectOneMessageQueue(topicPublishInfo, lastBrokerName);

    }
 }
```

- 可以看到变量 mq 是定义在循环外的，所以在第一次正常投递 message 时，它肯定为 null，只有在第2、3 次循环时 mq 才有值，而进行到了 2、3 次就说明首次投递失败，需要重新进行选择了。



即整体的选择逻辑如下图：

![image-20240503180555393](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240503180555393.png)

- lastBrokerName 不为空，代表首次投递出了问题，而**选择 MessageQueue 的背后还有一个隐含的逻辑**：**选择 Broker**。最终一个 MessageQueue 是需要具体存在于某个 Broker 上的，所以选择 MessageQueue 也有一层隐含的意思是在选择 Broker。
- 而投递失败意味着单台 Broker 的网络或者所在机器出了问题，那么下次重新选择时，如果再选到同一台 Broker 投递大概率还是会继续失败，所以为了尽可能让 Message 投递成功，会选择另一台 Broker 进行投递。



## 三、深入了解 Topic 和 MessageQueue

可能有同学会有疑问，之前不是已经讲过 MessageQueue 了，我们也知道了它可能分布在多个不同的 Broker 上，就像这样：

![img](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/1712678105948-df0205c2-0fe5-4e92-bdb8-3991dc62fe81.png)

这是因为上面这个图描述正确，但不准确。



### 3.1 关于 Topic

在 broker.conf 当中有一个配置项叫 autoCreateTopicEnable，含义是如果当前这个 Topic 不存在，则会自动创建。但实际上**强烈不推荐**在生产环境启用这个配置，一旦启用这个配置之后可能会**造成大量无法管理、回收的无效主题**，整个 Topic 的生命周期需要我们自己进行管理。

相信大家在自己公司内如果需要一个新的 Topic，肯定不是直接写在配置文件中就完了，大概率是需要找对应的同学或者提工单申请的。这也是为什么我们在 Demo 运行环境要带领大家去自己创建 Topic，也是提醒大家要养成一个良好的习惯。



Topic 并不一定存在于所有的 Broker 上，可以看到在创建时我们可以选择具体在哪些 Broker 上创建。假设我们现在有个 Topic 名称叫 `TestForMessageQueue`，然后读、写队列的**数量为 4**。并且，在 `broker-a` 和 `broker-b` 上都创建了 Topic。在之前的 Demo 运行环节我们只启动了一台 Broker，但如果只有 1 台 Broker 就无法很好地理解这里的**避让逻辑**。



### 3.2 关于 MessageQueue

Topic 在 broker-a 和 broker-b 上创建成功之后，MessageQueue 的分布实际上并不像简要架构图当中展示的那样，实际 MessageQueue 的分布应该是这样：

![MessageQueue分布](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240503185645138.png)

- 从上图我们可以得出一个结论：BrokerName、QueueId 可以唯一确定一个 MessageQueue；
- 这也就是为什么 TopicPublishInfo 在存储 MessageQueue 列表数据时，里面会有一个 BrokerName 字段；



## 四、核心选择算法

核心选择逻辑的代码很简单：

```java
// 类: TopicPublishInfo
private volatile ThreadLocalIndex sendWhichQueue = new ThreadLocalIndex();
public MessageQueue selectOneMessageQueue() {
    int index = this.sendWhichQueue.getAndIncrement();
    int pos = Math.abs(index) % this.messageQueueList.size();
    if (pos < 0)
        pos = 0;
    return this.messageQueueList.get(pos);
}
```

这段代码中有个熟悉的字段：sendWhichQueue，它是 TopicPublishInfo 的一个字段，就是一个单纯的数字。核心逻辑就是将 index 与 MessageQueue 的数量取余，得到的结果就代表 `this.messageQueueList` 数组的下标，比如是 1，那么就选择下标为 1 的 MessageQueue。



而计算、获取  sendWhichQueue 的逻辑就更加简单了：

```java
public class ThreadLocalIndex {
    private final ThreadLocal<Integer> threadLocalIndex = new ThreadLocal<Integer>();
    private final Random random = new Random();

    public int getAndIncrement() {
        Integer index = this.threadLocalIndex.get();
        //如果index为空就先生成
        if (null == index) {
            index = Math.abs(random.nextInt());
            this.threadLocalIndex.set(index);
        }
		// 根据之前的值进行增加
        index = Math.abs(index + 1);
        this.threadLocalIndex.set(index);
        return index;
    }
}
```

- 在首次进入 getAndIncrement 逻辑时，index 肯定是 null，所以这里会随机生成一个数，而后续的调用都会在最初生成的随机值上自增；
- 可以把这个算法理解成一个线性轮询的负载均衡算法，它可以将流量均匀地分给不同的 MessageQueue，而 MessageQueue 分布在不同的 Broker 上，这样也达到了对最终 Message 存储的负载均衡，避免造成数据倾斜。





