# 快递员准备上面取件——Producer 启动流程分析



## 一、背景

不知道大家在寄快递时是否使用过上门取件的服务，我们在快递类 APP 上找到寄件的服务，它会让我们提供一些关键的信息，例如：

- 当前是谁在寄件？寄件地址是哪里？联系方式是啥？
- 这个包裹要寄送到哪里去？
- 预期的快递员上门时间是什么时候？
- 物品的一些元数据，例如是日用品、文件，还是食品？

Producer 发送 Message 也是类似的。我们只需要负责把 Message 给打包好，然后交给 Prodcuer，至于 Producer 是如何找到 Topic 对应的 Broker，如何发送过去，对于使用方来说是完全**黑盒**的，大部分情况下我们也不关心。

其中，Message 的 `Topic` 可以理解为寄件的地址，Message 的 `Tag` 就类似于这个包裹是日用品、文件、食品，包裹里装的内容就是 Message 的 `Body`。



## 二、Producer 投递 Message 流程



### 2.1 配置并启动 Producer

在 RocketMQ 中，很多组件其实都遵循如下的流程：

![组件的大致使用流程](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/2d5a8da9fdaf4df2a4169b34b3c09ee7~tplv-k3u1fbpfcp-jj-mark:1512:0:0:0:q75.awebp)

先把对应的组件实例化出来，然后再将其依赖的各个组件给 start 起来，最后就可以开始使用它了，这个 start 方法就是我们分析的重点。

RocketMQ 中 Producer 对应的类是 DefaultMQProducer，调用其 start 方法是为后续真正投递 Message 做准备：

```java
public void start() throws MQClientException {
    // 基于命名空间对 ProducerGroup 再次封装, 一般用于在不同的业务场景下做隔离
    this.setProducerGroup(withNamespace(this.producerGroup));
    // 本章要探索的重点 start() 方法
    this.defaultMQProducerImpl.start();
    // 用于做消息追踪
    if (null != traceDispatcher) {
        try {
            traceDispatcher.start(this.getNamesrvAddr(), this.getAccessChannel());
        } catch (MQClientException e) {
            log.warn("trace dispatcher start failed ", e);
        }
    }
}
```

- 代码的核心其实是 DefaultMQProducerImpl 的 start 方法；



### 2.2 调用 DefaultMQProducerImpl 的 start 方法



下面我们会分析 DefaultMQProducerImpl  的 start 方法：

```java
public class DefaultMQProducerImpl implements MQProducerInner {
	public void start(final boolean startFactory) throws MQClientException {
        switch (this.serviceState) {
            // 根据初始化状态执行
            case CREATE_JUST:
                this.serviceState = ServiceState.START_FAILED;
				// 2.2.2校验ProducerGroup是否合法
                this.checkConfig();

                if (!this.defaultMQProducer.getProducerGroup().equals(MixAll.CLIENT_INNER_PRODUCER_GROUP)) {
                    // 2.2.3计算InstanceName
                    this.defaultMQProducer.changeInstanceNameToPID();
                }
			   // 2.2.4 初始化 MQClientInstance
                this.mQClientFactory = MQClientManager.getInstance().getOrCreateMQClientInstance(this.defaultMQProducer, rpcHook);
				// 2.2.5 注册Producer信息
                boolean registerOK = mQClientFactory.registerProducer(this.defaultMQProducer.getProducerGroup(), this);
                if (!registerOK) {
                    this.serviceState = ServiceState.CREATE_JUST;
                    throw new MQClientException("The producer group[" + this.defaultMQProducer.getProducerGroup()
                        + "] has been created before, specify another name please." + FAQUrl.suggestTodo(FAQUrl.GROUP_NAME_DUPLICATE_URL),
                        null);
                }

                this.topicPublishInfoTable.put(this.defaultMQProducer.getCreateTopicKey(), new TopicPublishInfo());

                if (startFactory) {
                    // 2.2.6 启动 MQClientInstance
                    mQClientFactory.start();
                }

                log.info("the producer [{}] start OK. sendMessageWithVIPChannel={}", this.defaultMQProducer.getProducerGroup(),
                    this.defaultMQProducer.isSendMessageWithVIPChannel());
                this.serviceState = ServiceState.RUNNING;
                break;
            case RUNNING:
            case START_FAILED:
            case SHUTDOWN_ALREADY:
                throw new MQClientException("The producer service state not OK, maybe started once, "
                    + this.serviceState
                    + FAQUrl.suggestTodo(FAQUrl.CLIENT_SERVICE_NOT_OK),
                    null);
            default:
                break;
        }

        this.mQClientFactory.sendHeartbeatToAllBrokerWithLock();

        this.timer.scheduleAtFixedRate(new TimerTask() {
            @Override
            public void run() {
                try {
                    RequestFutureTable.scanExpiredRequest();
                } catch (Throwable e) {
                    log.error("scan RequestFutureTable exception", e);
                }
            }
        }, 1000 * 3, 1000);
    }
}
```





#### 2.2.1 四种不同的状态

对于一个 Producer 实例来说，总共会有4种不同的状态：

```java
public enum ServiceState {
    /**
     * Service just created,not start
     */
    CREATE_JUST,
    /**
     * Service Running
     */
    RUNNING,
    /**
     * Service shutdown
     */
    SHUTDOWN_ALREADY,
    /**
     * Service Start failure
     */
    START_FAILED;
}

```

- 当 Producer 启动时，它的状态就是默认的 `CREATE_JUST`，这是 Producer 实例化之后默认的状态，在初始化时就会设置一个默认值；

- 当 start 方法调用成功后，Producer 就会将状态修改为 `RUNNING`，失败了就会变成 `START_FAILED` 。



#### 2.2.2 校验 ProducerGroup

快递员侧收到了取件订单，是不是得检查检查地址是不是合法的，万一寄件地址填了个 M78 星云，这让快递小哥怎么去？Producer 也同样会对传入的 Producer Group 的名称进行校验，主要是：

- ProducerGroup 是否为空？
- ProducerGroup 名称是否超过了最大长度？这个值 CHARACTER_MAX_LENGTH 默认是 255。
- ProducerGroup 名称是否包含非法字符？

```java
private void checkConfig() throws MQClientException {
    Validators.checkGroup(this.defaultMQProducer.getProducerGroup());

    if (null == this.defaultMQProducer.getProducerGroup()) {
        throw new MQClientException("producerGroup is null", null);
    }

    if (this.defaultMQProducer.getProducerGroup().equals(MixAll.DEFAULT_PRODUCER_GROUP)) {
        throw new MQClientException("producerGroup can not equal " + MixAll.DEFAULT_PRODUCER_GROUP + ", please specify another one.",
            null);
    }
}
```



#### 2.2.3 计算 InstanceName

InstanceName 表示当前 Producer 实例的名称，其实就是 pid，其计算逻辑如下：

```java
public void changeInstanceNameToPID() {
    if (this.instanceName.equals("DEFAULT")) {
        this.instanceName = String.valueOf(UtilAll.getPid());
    }
}
```



#### 2.2.4 初始化 MQClientInstance

MQClientInstance 是 Producer 内部的一个组件，其中封装了相当多的客户端操作在其中，并且，它不仅仅只在 Producer 当中使用，在实例化 Consumer 时也会使用它。Producer 和 Consumer 都共同依赖了 MQClientInstance 这个组件。



```java
public MQClientInstance getOrCreateMQClientInstance(final ClientConfig clientConfig, RPCHook rpcHook) {
    // 生成 clientId
    String clientId = clientConfig.buildMQClientId();
    // 从这个 table 里先获取一次，其实这个table是一个map
    MQClientInstance instance = this.factoryTable.get(clientId);
     // 第一次进来, table 肯定没有数据, 所以它一定是 null
    if (null == instance) {
         // 所以肯定会进到这里来, 调用构造函数将其实例化出来
        instance =
            new MQClientInstance(clientConfig.cloneClientConfig(),
                this.factoryIndexGenerator.getAndIncrement(), clientId, rpcHook);
         // 生成好之后就会写入 factoryTable 中, 所以后续再次调用这个方法就能够获取到了
        MQClientInstance prev = this.factoryTable.putIfAbsent(clientId, instance);
        if (prev != null) {
            instance = prev;
            log.warn("Returned Previous MQClientInstance for clientId:[{}]", clientId);
        } else {
            log.info("Created new MQClientInstance for clientId:[{}]", clientId);
        }
    }

    return instance;
}
```

- 这样的方式也是防止多次地重复调用、重复生成。而上面提到的 **ClientId**，大家可以理解为客户端的**唯一标识**，在后续进行 MessageQueue 分配时，也会根据 ClientId 来进行分配。需要注意的是，如果 ClientId 重复，会导致比较严重的问题，例如**消息堆积**。

ClientId 生成的代码：

```java
public String buildMQClientId() {
    StringBuilder sb = new StringBuilder();
    sb.append(this.getClientIP());

    sb.append("@");
    sb.append(this.getInstanceName());
    if (!UtilAll.isBlank(this.unitName)) {
        sb.append("@");
        sb.append(this.unitName);
    }

    return sb.toString();
}
```

- 它由两部分组成：IP 地址+ InstanceName



#### 2.2.5 登记 Producer 信息

Producer 会将自己注册到 MQClientInstance 中维护的 producerTable 中，里面包含了会存储当前客户端中 Producer 的一些信息。但大家应该还记得前面提到过 Consumer 内部也会使用 MQClientInstance，在其内部还有一个 `consumerTable`，用于存储消费者客户端里的所有 Consumer 信息。



```java
public boolean registerProducer(final String group, final DefaultMQProducerImpl producer) {
    if (null == group || null == producer) {
        return false;
    }

    MQProducerInner prev = this.producerTable.putIfAbsent(group, producer);
    if (prev != null) {
        log.warn("the producer group[{}] exist already.", group);
        return false;
    }

    return true;
}
```



#### 2.2.6 启动 MQClientInstance

最后就会调用 MQClientInstance 的 start 方法来初始化一些核心逻辑。我们知道 Producer 需要投递 Message 到 Broker，那么必须和 Broker 建立连接。Producer 也需要和 NameServer 通信获取 Broker 的相关元数据。除此之外，Producer 会有很多状态、信息需要维护，所以它会启动一堆定时任务来更新它们的状态。

![image-20240503003353187](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240503003353187.png)

主要有以下方面的内容：

- **获取 NameServer 的地址**，这里值得注意的是，只有在 Producer 没有指定 NameServer 地址时才会注册、运行这个定时任务，也就是以下的代码。
- **定时从 NameServer 更新本地维护的 Topic 相关数据**。这里是`批量`地运行。即 MQClientInstance 在运行这部分更新数据的逻辑是不会关心是 Producer 还是 Consumer，它会从两个 Table 中解析出所有的 Topic 的列表，然后批量地去 NameServer 更新数据，因为无论是 Producer 还是 Consumer 都需要使用到这些元数据。

![去NameServer更新数据](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/92a087b28ef24270a0c966be13cf5c24~tplv-k3u1fbpfcp-jj-mark:1512:0:0:0:q75.awebp)

- **清理无效的、下线的 Broker**。这里就根据拿到 Topic 元数据当中的 Broker 相关数据，和本地维护的 Broker 数据进行对比，清理掉在 Topic 元数据中不存在的 Broker；
- **向所有 Broker 发送心跳**。一来告诉 Broker 我还活着，二来定时刷新 Broker 存的客户端数据。发送心跳的可以是 Producer，也可以是 Consumer，具体看谁在使用 MQClientInstance。
  - 如果是 Producer，那么心跳所包含的数据很少，就只有当前客户端的所有**生产者组**。
  - 如果是 Consumer，那数据就多了，比如都有哪些消费者组的名称、消费的模式是广播还是集群、从哪里开始消费数据、消费者消费的 Topic 的简要数据等。
- **持久化 Offset（如果是 Consumer 的话）**。脑图最下方的持久化 Offset，其实就是如果当前客户端是 Consumer，就会将当前消费到哪儿了持久化起来，不然下次重启就不知道从哪里开始，从头开始？那已经消费过的消息再消费一次不就变成重复消费了吗？所以定时持久化 Offset 是非常必要的一个操作。



代码如下：

```java
public void start() throws MQClientException {

    synchronized (this) {
        switch (this.serviceState) {
            case CREATE_JUST:
                this.serviceState = ServiceState.START_FAILED;
                // If not specified,looking address from name server 
                // 获取 NameServer 的地址
                if (null == this.clientConfig.getNamesrvAddr()) {
                    this.mQClientAPIImpl.fetchNameServerAddr();
                }
                // Start request-response channel
                this.mQClientAPIImpl.start();
                // Start various schedule tasks
                this.startScheduledTask();
                // Start pull service
                this.pullMessageService.start();
                // Start rebalance service
                this.rebalanceService.start();
                // Start push service
                this.defaultMQProducer.getDefaultMQProducerImpl().start(false);
                log.info("the client factory [{}] start OK", this.clientId);
                this.serviceState = ServiceState.RUNNING;
                break;
            case START_FAILED:
                throw new MQClientException("The Factory object[" + this.getClientId() + "] has been created before, and failed.", null);
            default:
                break;
        }
    }
}
```



  


