# NameServer 解析

NameServer 是 RocketMQ 集群的大脑，它负责存储 RocketMQ 集群的元信息，例如 Topic 有多少个 MessageQueue，又分别在哪些 Broker 上，等等，没了 NameServer，RocketMQ 集群将无法正常运行。



## 一、NameServer 启动流程分析

NameServer 的启动其实也是遵循三板斧，在 NameServer 中，存在一个组件叫 NameSrvController，会先把 NameServer 实例化出来，然后再启动。



### 1.1 初始化 NamesrvController

 ```java
 // 源码位置:
 // 子项目: namesrv
 // 包名: org.apache.rocketmq.namesrv;
 // 文件: NamesrvStartup
 // 行数: 54
 public static NamesrvController main0(String[] args) {
   //......
   NamesrvController controller = createNamesrvController(args);
   start(controller);
   //......
 }
 ```

流程上简直和 Broker 是一个模子刻出来的，所以有了对 Broker 的理解，NameSrvController 的启动流程理解起来就会相对容易一些。



### 1.2 解析 CommandLine

我们知道，在 Broker 启动的时候会去解析命令行参数到 CommandLine 中，NameServer 也是同理，它也有这个步骤。Broker 会根据命令行中解析出来的配置，最终解析出关键的配置类 BrokerConfig；NameServer 也是同理，会根据对应的配置，得到一个 NameServer 中的关键配置类：NamesrvConfig。



### 1.3 校验 ROCKET_HOME

大家应该还记得，我们在运行 NameServer 之前还配置了 ROCKETMQ_HOME 这个环境变量，Broker 和 NameServer 都会对其进行校验：

```java
// 源码位置:
// 包名: org.apache.rocketmq.namesrv;
// 文件: NamesrvStartup
// 行数: 110
if (null == namesrvConfig.getRocketmqHome()) {
  System.out.printf("Please set the %s variable in your environment to match the location of the RocketMQ installation%n", MixAll.ROCKETMQ_HOME_ENV);
  System.exit(-2);
}
```



### 1.4 初始化 NameSrvController

在进行了一些基本的配置后，会调用 NameSrvController 的 initialize 方法来初始化一些非常核心的组件。相信大家有一定记得 Broker 在将 BrokerController 实例化之后，也会调 Broker 侧的 `initialize()` 方法。不能说毫无关系，简直一模一样。

```java
// 源码位置:
// 包名: org.apache.rocketmq.namesrv;
// 文件: NamesrvController
// 行数: 76
public boolean initialize() {
  //......
}
```

我们知道，Producer 会和 NameServer 进行交互，Consumer 也会和 NameServer 进行交互，甚至连 Broker 也会和 NameServer 交互，而这些交互方式都是通过请求的方式来进行。

所以，NameServer 必然会和 Broker 一样注册相对应的 Processor 来处理相关请求。负责这一艰巨任务的是 **DefaultRequestProcessor**，这里会根据 **RequestCode** 的不同进行不同的处理。



### 1.5 清理掉下线的 Broker

在 NameServer 会注册一个定时任务，周期性地清理掉已经失效的 Broker：

```java
// 源码位置:
// 子项目: namesrv
// 包名: org.apache.rocketmq.namesrv;
// 文件: NamesrvController
// 行数: 87
this.scheduledExecutorService.scheduleAtFixedRate(NamesrvController.this.routeInfoManager::scanNotActiveBroker, 5, 10, TimeUnit.SECONDS);
```

如果某个 Broker 在 NameServer 注册之后又因自身或者网络问题下线了，NameServer 不做处理的话会被其他的组件当成有效的 Broker，即使这个 Broker 已经挂掉了。所以，定期对 Broker 的状态进行判断、再根据状态执行对应的清理操作是很有必要的。



我们知道，Broker 会每隔 30s 向 NameServer 发送心跳，而 NameServer 侧的检查逻辑则是每 10 秒 执行一次：

![NameServer移除异常的Broker](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240513112302994.png)

代码如下：

```java
// 源码位置:
// 子项目: namesrv
// 包名: org.apache.rocketmq.namesrv.routeinfo;
// 文件: RouteInfoManager
// 行数: 468
public int scanNotActiveBroker() {
    int removeCount = 0;
    Iterator<Entry<String, BrokerLiveInfo>> it = this.brokerLiveTable.entrySet().iterator();
    while (it.hasNext()) {
        Entry<String, BrokerLiveInfo> next = it.next();
        long last = next.getValue().getLastUpdateTimestamp();
        if ((last + BROKER_CHANNEL_EXPIRED_TIME) < System.currentTimeMillis()) {
            RemotingUtil.closeChannel(next.getValue().getChannel());
            //移除该Broker信息
            it.remove();
            log.warn("The broker channel expired, {} {}ms", next.getKey(), BROKER_CHANNEL_EXPIRED_TIME);
            this.onChannelDestroy(next.getKey(), next.getValue().getChannel());

            removeCount++;
        }
    }

    return removeCount;
}
```

- 代码中的 BROKER_CHANNEL_EXPIRED_TIME 默认就是 2 分钟；



## 二、从使用场景解析 NameServer

其实单单从上面的启动流程里是看不出更多的细节的，相信大家印象最深的应该就只有 NameServer 会每隔 10 秒去尝试清理一次已经 120 秒没有发送过心跳的 Broker。

所以，接下来会从一些详细的场景入手，来更深入地了解 NameServer 的作用。



### 2.1 Producer 投递 Message 时获取 Topic 路由信息

在 Producer 投递 Message 时， 会根据 Message 中指定的 Topic 字符串，对 NameServer 发起请求，以获取 Topic 的路由数据：

![查询Topic信息](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240513123920896.png)

上图中的 Topic 路由信息就是在前面章节给大家讲过的 **TopicPublishInfo**。

在 NameServer 中负责根据 Topic 字符串，拿到对应的路由信息的组件是 **RouteInfoManager**：

![根据Topic字符串获取Topic信息](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240513132927988.png)

RouteInfoManager 是在 NameSrvController 实例化时，在其构造函数中被初始化的：

```java
// 源码位置:
// 子项目: namesrv
// 包名: org.apache.rocketmq.namesrv;
// 文件: NamesrvController
// 行数: 63
public NamesrvController(NamesrvConfig namesrvConfig, NettyServerConfig nettyServerConfig) {
  //......
  this.routeInfoManager = new RouteInfoManager();
  //......
}
```

RouteInfoManager 实际上是由多个 Map 组成的一个较大的信息中心：

```java
public RouteInfoManager() {
    this.topicQueueTable = new HashMap<>(1024);
    this.brokerAddrTable = new HashMap<>(128);
    this.clusterAddrTable = new HashMap<>(32);
    this.brokerLiveTable = new HashMap<>(256);
    this.filterServerTable = new HashMap<>(256);
}
```

比如 `brokerLiveTable` ，用于保存存活（活跃）的 Broker，就是由 RouteInfoManger 来负责存储的。

再比如，本小节探索的请求 `GET_ROUTEINFO_BY_TOPIC`，则是由 `topicQueueTable` 来提供的数据，此 Map 的 Key 就是 Topic，Value 就是 MessageQueue 在 Broker 中的分布，由于会存在多个 Broker，所以这也是个 Map，这个子 Map 的 Key 是 Broker 的名称，Value 则是 MessageQueue 对应的数据。



### 2.2 Broker 注册到自己的 NameServer

Broker 在启动时会将自己注册到 NameServer 上，并且会定时地发送心跳给 NameServer，NameServer 也会定时 地清理掉已经未存活的 Broker。而 Broker 注册自己到 NameServer 对应的 RequestCode 是 `REGISTER_BROKER`，NameServer 对应的 Handler 在：

```java
// 源码位置:
// 子项目: namesrv
// 包名: org.apache.rocketmq.namesrv.processor;
// 文件: DefaultRequestProcessor
// 行数: 97
case RequestCode.REGISTER_BROKER:
  //......
	return this.registerBrokerWithFilterServer(ctx, request);
	//......	
```



在 registerBroker 方法中，首先被更新的是 RouteInfoManager 中的 **clusterAddrTable**，它用于存储**某个集群下面所有的 Broker 名称**：

```java
// 源码位置:
// 子项目: namesrv
// 包名: org.apache.rocketmq.namesrv.routeinfo;
// 文件: RouteInfoManager
// 行数: 152
Set<String> brokerNames = this.clusterAddrTable.computeIfAbsent(clusterName, k -> new HashSet<>());
brokerNames.add(brokerName);
```

- 这个 `computeIfAbsent()` 是 `java.util` 提供的方法，在这里的作用很简单，如果我们传入的 `clusterName` 不存在，则执行 `k -> new HashSet<>()` 这部分逻辑，这里的含义是为不存在的 Key 创建默认的空 Set 作为 Value。而返回的 `brokerNames` 就是返回的 Set 的**引用**，再调用 `brokerNames.add(brokerName);` 即可将 Broker 的名称更新到 `clusterAddrTable` 当中去了。



接着就会更新 **brokerAddrTable**，用于**存储 Broker 名称与其地址的映射关系**，相关代码如下：

```java
// 源码位置:
// 子项目: namesrv
// 包名: org.apache.rocketmq.namesrv.routeinfo;
// 文件: RouteInfoManager
// 行数: 157
BrokerData brokerData = this.brokerAddrTable.get(brokerName);
if (null == brokerData) {
  // 表明是首次注册, 第一次一定会走到这里来
  registerFirst = true;
  brokerData = new BrokerData(clusterName, brokerName, new HashMap<>());
  this.brokerAddrTable.put(brokerName, brokerData);
}
//......
String oldAddr = brokerData.getBrokerAddrs().put(brokerId, brokerAddr);
```

- 对于首次注册的 Broker 来说，这里拿到的 `brokerData` 一定是 NULL，所以这里会直接实例化一个新的 BrokerData，并将其放入 `brokerAddrTable` 当中。然后用和 `clusterAddrTable` 类似的方法，将 Broker 的地址 `brokerAddr` 更新到 `brokerData` 当中。



 有了 Broker 本身的元数据之后，接下来就处理 Broker 与 MessageQueue 的相关数据了：

```java
// 源码位置:
// 子项目: namesrv
// 包名: org.apache.rocketmq.namesrv.routeinfo;
// 文件: RouteInfoManager
// 行数: 190
for (Map.Entry<String, TopicConfig> entry : tcTable.entrySet()) {
  // 遍历这个 Map, 为此 Map 的所有 Topic 初始化 MessageQueue 的数据
  this.createAndUpdateQueueData(brokerName, entry.getValue());
}
```



这个 tcTable 全称其实叫 topicConfigTable，就是 Broker 心跳时所传给 NameServer 的数据。这个 tcTable 里会有很多 Topic 及其对应的数据，所以这里需要对 Map 进行遍历来创建 MessageQueue 的相关数据：

```java
// 源码位置:
// 子项目: namesrv
// 包名: org.apache.rocketmq.namesrv.routeinfo;
// 文件: RouteInfoManager
// 行数: 255
private void createAndUpdateQueueData(final String brokerName, final TopicConfig topicConfig) {
  // 根据 Broker 传过来的数据构建 MessageQueue 的数据
  QueueData queueData = new QueueData();
  queueData.setBrokerName(brokerName);
  queueData.setWriteQueueNums(topicConfig.getWriteQueueNums());
  queueData.setReadQueueNums(topicConfig.getReadQueueNums());
  queueData.setPerm(topicConfig.getPerm());
  queueData.setTopicSysFlag(topicConfig.getTopicSysFlag());

  Map<String, QueueData> queueDataMap = this.topicQueueTable.get(topicConfig.getTopicName());
  if (null == queueDataMap) {
    // 对于首次注册的 Topic 来说会走到这里, 并对 Map 的 Value queueDataMap 做了一个初始化
    queueDataMap = new HashMap<>();
    queueDataMap.put(queueData.getBrokerName(), queueData);
    this.topicQueueTable.put(topicConfig.getTopicName(), queueDataMap);
    log.info("new topic registered, {} {}", topicConfig.getTopicName(), queueData);
  } else {
    // 这里最大的区别在于打的日志不同
    QueueData old = queueDataMap.put(queueData.getBrokerName(), queueData);
    if (old != null && !old.equals(queueData)) {
      log.info("topic changed, {} OLD: {} NEW: {}", topicConfig.getTopicName(), old,
               queueData);
    }
  }
}
```

对于首次注册的 Topic 来说，是一定会将组织好的 MessageQueue 的数据传入 topicQueueTable 当中的，而如果之前已经存在了，也会直接执行覆盖逻辑。



而最后更新的就是 **brokerLiveTable** 了，NameServer 会根据这里更新的数据来判定 Broker 是否存活：

```java
// 源码位置:
// 子项目: namesrv
// 包名: org.apache.rocketmq.namesrv.routeinfo;
// 文件: RouteInfoManager
// 行数: 197
BrokerLiveInfo prevBrokerLiveInfo = this.brokerLiveTable.put(brokerAddr,
  new BrokerLiveInfo(
    // 更新心跳的时间
    System.currentTimeMillis(),
    topicConfigWrapper.getDataVersion(),
    channel,
    haServerAddr));
```

这里的心跳时间会取 NameServer 收到请求的当前时间，即 System.currentTimeMills()，由于后续的心跳也是走同样的逻辑，不仅仅是第一次心跳时会调用。



## 三、总结

从启动流程我们可以看出，NameServer 的细节比起 Broker 少很多。这是符合预期的，NameServer 所扮演的角色本来就很纯粹，不像 Broker 身兼重任，又要负责存储 Message，还要负责建立索引，甚至还要管理各个 Consumer 的消费进度。

对于 NameServer 来说，其负责的功能越简单，代表其出错的可能性越小，而再对应 NameServer 在集群中如此重要的地位，这样的设计会更合适些。

除此之外，我们通过两个实际的场景继续深入了解了 NameServer 内部的构造，相信大家一定对 NameServer 的结构有一定的认知了。



















