# Broker 心跳机制解析



## 一、背景

Broker 的运行离不开 NameServer 的支持，它可是号称 RocketMQ 集群大脑的存在，Broker 会定期和 NameServer 交互，这个交互的方式就是心跳。



## 二、心跳机制解析



### 2.1 心跳时间计算

在向 NameServer 注册的同时，Broker 会在请求中带上自己的相关数据，然后以注册的方式发送到 NameServer，这样一来完成了心跳还更新了数据。

在 BrokerController 的 start 方法中，就启动了一个定时任务来启动心跳：

```java
public void start() throws Exception {
    this.scheduledExecutorService.scheduleAtFixedRate(new Runnable() {
        @Override
        public void run() {
            try {
                BrokerController.this.registerBrokerAll(true, false, brokerConfig.isForceRegister());
            } catch (Throwable e) {
                log.error("registerBrokerAll Exception", e);
            }
        }
    }, 1000 * 10, Math.max(10000, Math.min(brokerConfig.getRegisterNameServerPeriod(), 60000)), TimeUnit.MILLISECONDS);
}
```

- 对上面的代码进行分析我们会发现，它本质上是一个**定时任务**，`1000 * 10` 代表着首次执行时，延迟 10 秒再执行，而执行的间隔就由后面的这一长串 `Math.max(10000, Math.min(brokerConfig.getRegisterNameServerPeriod(), 60000))` 计算逻辑来决定。

- registerNameServerPeriod 默认是30000毫秒，即 30秒，所以这个默认值就是 30 秒；
-  Math.min(brokerConfig.getRegisterNameServerPeriod(), 60000) 这个计算时间的代码逻辑就把时间控制在了 [10, 60] 秒内；



### 2.2 注册流程解析

现在我们知道了启动心跳的地方、心跳执行的时间间隔，接下来我们要探索的就是心跳具体都执行了什么逻辑了：

```java
// 源码位置:
// 项目: brokerr
// 包名: org.apache.rocketmq.broker;
// 文件: BrokerController
// 行数: 940
public synchronized void registerBrokerAll(final boolean checkOrderConfig, boolean oneway, boolean forceRegister) {
    TopicConfigSerializeWrapper topicConfigWrapper = this.getTopicConfigManager().buildTopicConfigSerializeWrapper();
	//....
    if (forceRegister || needRegister(this.brokerConfig.getBrokerClusterName(),
        this.getBrokerAddr(),
        this.brokerConfig.getBrokerName(),
        this.brokerConfig.getBrokerId(),
        this.brokerConfig.getRegisterBrokerTimeoutMills())) {
        //执行心跳注册操作
        doRegisterBrokerAll(checkOrderConfig, oneway, topicConfigWrapper);
    }
}
```

其实并不是所有的情况都会执行心跳，要满足以下两个条件：

- **forceRegister** 为 true，此参数在 Broker 启动时默认为 true；
- **needRegister** 的判断为 true，即 RocketMQ 经过检查发现需要执行注册，这块的判断逻辑我后面会讲。



所以启动时，Broker 一定会执行一次心跳逻辑，因为它不仅仅是心跳本身，还会传输数据，而这就必然会涉及到和投递 Message 类似的操作，即构建 **Header**、**Body**，**然后发送请求**，如下图所示：

![image-20240504144728154](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240504144728154.png)



我们假设有 3 台 NameServer，那么 Broker 就会使用**线程池**并发地执行注册。这里会用到 CountDownLatch 来等待所有结果的返回

```java
// 源码位置:
// 项目: brokerr
// 包名: org.apache.rocketmq.broker;
// 文件: BrokerController
// 行数: 957
private void doRegisterBrokerAll(boolean checkOrderConfig, boolean oneway,
    TopicConfigSerializeWrapper topicConfigWrapper) {
    //执行注册
    List<RegisterBrokerResult> registerBrokerResultList = this.brokerOuterAPI.registerBrokerAll(
        this.brokerConfig.getBrokerClusterName(),
        this.getBrokerAddr(),
        this.brokerConfig.getBrokerName(),
        this.brokerConfig.getBrokerId(),
        this.getHAServerAddr(),
        topicConfigWrapper,
        this.filterServerManager.buildNewFilterServerList(),
        oneway,
        this.brokerConfig.getRegisterBrokerTimeoutMills(),
        this.brokerConfig.isCompressedRegister());
}


```

- 调用 BrokerOuterAPI 的 registerBrokerAll 的方法进行心跳注册



```java
// 源码位置:
// 项目: broker
// 包名: org.apache.rocketmq.broker.out;
// 文件: BrokerOuterAPI
// 行数: 113
public List<RegisterBrokerResult> registerBrokerAll(
    final String clusterName,
    final String brokerAddr,
    final String brokerName,
    final long brokerId,
    final String haServerAddr,
    final TopicConfigSerializeWrapper topicConfigWrapper,
    final List<String> filterServerList,
    final boolean oneway,
    final int timeoutMills,
    final boolean compressed) {

    final List<RegisterBrokerResult> registerBrokerResultList = new CopyOnWriteArrayList<>();
    List<String> nameServerAddressList = this.remotingClient.getNameServerAddressList();
    if (nameServerAddressList != null && nameServerAddressList.size() > 0) {
		//构造header
        final RegisterBrokerRequestHeader requestHeader = new RegisterBrokerRequestHeader();
        requestHeader.setBrokerAddr(brokerAddr);
        requestHeader.setBrokerId(brokerId);
        requestHeader.setBrokerName(brokerName);
        requestHeader.setClusterName(clusterName);
        requestHeader.setHaServerAddr(haServerAddr);
        requestHeader.setCompressed(compressed);
		//构建body
        RegisterBrokerBody requestBody = new RegisterBrokerBody();
        requestBody.setTopicConfigSerializeWrapper(topicConfigWrapper);
        requestBody.setFilterServerList(filterServerList);
        final byte[] body = requestBody.encode(compressed);
        final int bodyCrc32 = UtilAll.crc32(body);
        requestHeader.setBodyCrc32(bodyCrc32);
        
        //通过CountDownLatch发送请求
        final CountDownLatch countDownLatch = new CountDownLatch(nameServerAddressList.size());
        for (final String namesrvAddr : nameServerAddressList) {
            brokerOuterExecutor.execute(() -> {
                try {
                    //发送请求，注册Broker
                    RegisterBrokerResult result = registerBroker(namesrvAddr, oneway, timeoutMills, requestHeader, body);
                    if (result != null) {
                        registerBrokerResultList.add(result);
                    }

                    log.info("register broker[{}]to name server {} OK", brokerId, namesrvAddr);
                } catch (Exception e) {
                    log.warn("registerBroker Exception, {}", namesrvAddr, e);
                } finally {
                    countDownLatch.countDown();
                }
            });
        }

        try {
            countDownLatch.await(timeoutMills, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
        }
    }

    return registerBrokerResultList;
}
```

- 向不同的 NameServer 注册的请求完成时间可能不尽相同，有的先完成，有的后完成，CountDownLatch 能够等待这些并发的注册全部都完成了，才继续执行后续的逻辑；



从而，上面的过程可以用下面的图来表示：

![image-20240504145603114](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240504145603114.png)



### 2.3 心跳传输数据

```java
// 源码位置:
// 项目: brokerr
// 包名: org.apache.rocketmq.broker;
// 文件: BrokerController
// 行数: 957
private void doRegisterBrokerAll(boolean checkOrderConfig, boolean oneway,
    TopicConfigSerializeWrapper topicConfigWrapper) {
    //执行注册
    List<RegisterBrokerResult> registerBrokerResultList = this.brokerOuterAPI.registerBrokerAll(
        this.brokerConfig.getBrokerClusterName(),
        this.getBrokerAddr(),
        this.brokerConfig.getBrokerName(),
        this.brokerConfig.getBrokerId(),
        this.getHAServerAddr(),
        topicConfigWrapper,
        this.filterServerManager.buildNewFilterServerList(),
        oneway,
        this.brokerConfig.getRegisterBrokerTimeoutMills(),
        this.brokerConfig.isCompressedRegister());
}
```

其实  topicConfigWrapper 就是我们传输的 Broker 数据，关键的字段共有两个：

- **topicConfigTable**：是个 Map，Key 就是 Topic 名称，Value 则是 TopicConfig，就拿咱们发送消息时创建的 Topic 举例子，里面有读、写 MessageQueue 的数量、Topic 名称之类的数据；
- **dataVersion**：里面就是两个字段，分别是 dataVersion 和 counter，分别表示上次**更新的时间戳**以及**更新的次数**，简单来说就是**数据详情**和**数据版本**；

TopicConfigSerializeWrapper 类：

```java
public class TopicConfigSerializeWrapper extends RemotingSerializable {
    //所有的topic信息
    private ConcurrentMap<String, TopicConfig> topicConfigTable =
        new ConcurrentHashMap<String, TopicConfig>();
    //数据版本信息
    private DataVersion dataVersion = new DataVersion()
}
```



### 2.4 判断是否需要心跳

了解了 **DataVersion** 之后，我们就可以来回头看看上文提到过的 `needRegister()` 方法的判断逻辑了。

```java
// 源码位置:
// 项目: brokerr
// 包名: org.apache.rocketmq.broker;
// 文件: BrokerController
// 行数: 940
public synchronized void registerBrokerAll(final boolean checkOrderConfig, boolean oneway, boolean forceRegister) {
    TopicConfigSerializeWrapper topicConfigWrapper = this.getTopicConfigManager().buildTopicConfigSerializeWrapper();
	//....
    if (forceRegister || needRegister(this.brokerConfig.getBrokerClusterName(),
        this.getBrokerAddr(),
        this.brokerConfig.getBrokerName(),
        this.brokerConfig.getBrokerId(),
        this.brokerConfig.getRegisterBrokerTimeoutMills())) {
        //执行心跳注册操作
        doRegisterBrokerAll(checkOrderConfig, oneway, topicConfigWrapper);
    }
}
```

- 当 forceRegister 为 false 时，只有 needRegister 方法判定为 true 时，才会执行注册逻辑；



```java
// 源码位置:
// 项目: brokerr
// 包名: org.apache.rocketmq.broker;
// 文件: BrokerController
// 行数: 987
private boolean needRegister(final String clusterName,
    final String brokerAddr,
    final String brokerName,
    final long brokerId,
    final int timeoutMills) {
	//获取topicConfig配置
    TopicConfigSerializeWrapper topicConfigWrapper = this.getTopicConfigManager().buildTopicConfigSerializeWrapper();
    //发送判断是否需要注册请求
    List<Boolean> changeList = brokerOuterAPI.needRegister(clusterName, brokerAddr, brokerName, brokerId, topicConfigWrapper, timeoutMills);
    //最终判断
    boolean needRegister = false;
    for (Boolean changed : changeList) {
        if (changed) {
            needRegister = true;
            break;
        }
    }
    return needRegister;
}
```

- 获取 topicConfig 配置，接着调用 BrokerOuterAPI 去判断是否需要注册；



```java
public List<Boolean> needRegister(
    final String clusterName,
    final String brokerAddr,
    final String brokerName,
    final long brokerId,
    final TopicConfigSerializeWrapper topicConfigWrapper,
    final int timeoutMills) {
    final List<Boolean> changedList = new CopyOnWriteArrayList<>();
    //获取所有的NameServer的地址信息
    List<String> nameServerAddressList = this.remotingClient.getNameServerAddressList();
    if (nameServerAddressList != null && nameServerAddressList.size() > 0) {
        //定义CountDownLatch
        final CountDownLatch countDownLatch = new CountDownLatch(nameServerAddressList.size());
        //遍历所有NameServer的信息
        for (final String namesrvAddr : nameServerAddressList) {
            brokerOuterExecutor.execute(() -> {
                try {
                    //构造请求头部
                    QueryDataVersionRequestHeader requestHeader = new QueryDataVersionRequestHeader();
                    requestHeader.setBrokerAddr(brokerAddr);
                    requestHeader.setBrokerId(brokerId);
                    requestHeader.setBrokerName(brokerName);
                    requestHeader.setClusterName(clusterName);
                    //构造requestBody
                    RemotingCommand request = RemotingCommand.createRequestCommand(RequestCode.QUERY_DATA_VERSION, requestHeader);
                    request.setBody(topicConfigWrapper.getDataVersion().encode());
                    //调用底层网络请求
                    RemotingCommand response = remotingClient.invokeSync(namesrvAddr, request, timeoutMills);
                    DataVersion nameServerDataVersion = null;
                    Boolean changed = false;
                    switch (response.getCode()) {
                        case ResponseCode.SUCCESS: {
                            QueryDataVersionResponseHeader queryDataVersionResponseHeader =
                                (QueryDataVersionResponseHeader) response.decodeCommandCustomHeader(QueryDataVersionResponseHeader.class);
                            changed = queryDataVersionResponseHeader.getChanged();
                            byte[] body = response.getBody();
                            if (body != null) {
                                nameServerDataVersion = DataVersion.decode(body, DataVersion.class);
                                //如果DataVersion 不一致，如果不一致就设置为true
                                if (!topicConfigWrapper.getDataVersion().equals(nameServerDataVersion)) {
                                    changed = true;
                                }
                            }
                            if (changed == null || changed) {
                                changedList.add(Boolean.TRUE);
                            }
                        }
                        default:
                            break;
                    }
                    log.warn("Query data version from name server {} OK,changed {}, broker {},name server {}", namesrvAddr, changed, topicConfigWrapper.getDataVersion(), nameServerDataVersion == null ? "" : nameServerDataVersion);
                } catch (Exception e) {
                    changedList.add(Boolean.TRUE);
                    log.error("Query data version from name server {}  Exception, {}", namesrvAddr, e);
                } finally {
                    countDownLatch.countDown();
                }
            });

        }
        try {
            countDownLatch.await(timeoutMills, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            log.error("query dataversion from nameserver countDownLatch await Exception", e);
        }
    }
    return changedList;
}
```

- Broker 会去请求所有的 NameServer，查询自己传给 NameServer 的数据，然后跟自己本地的数据版本做一个对比，只要任一一台 NameServer 的数据是旧的，Broker 就会重新执行心跳，换句话说，needRegister 的判定就是 true。



上面代码流程如下图所示：

![image-20240504152036906](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240504152036906.png)





## 三、总结

心跳流程就介绍完了。虽然说启动的时候会立即执行一次心跳，但后续的运行并不是每次都会执行心跳，如果 Broker 的本地数据和所有远端 NameServer 都一样的话，就没有必要执行心跳，能够节省不必要的系统资源开销。

通过现在学习到的方法，去探索一下 NameServer 侧是如何应对这次 Broker 的数据查询请求的，相信你一定会有所收获。