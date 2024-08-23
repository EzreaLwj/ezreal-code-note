# Broker 启动流程分析



## 一、背景

根据前面的章节，Producer 发送出去的 Message，最终会被 Broker 接收，Broker 接收之后会将其进行持久化，等待 Consumer 进行消费。这节我们就来分析 Broker 是如何接收 Message，接受到 Message 后会进行什么处理，Message 又会以什么样的形式存储在 Broker 中呢，Consumer 来消费消息的时候是如何寻找 Message 的， 等等。在这一章我们回来解决这些问题。



## 二、Broker 初始化

还记得 RocketMQ 组件使用的“三板斧”吗？

![image-20240504000544074](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240504000544074.png)

实例化、start、使用，Broker 也不例外，接下来我们分析一下这个过程。



### 2.1 创建核心组件 BrokerController

BrokerController 是 Broker 的核心组件，果把 Broker 比作快递驿站，那么 BrokerController 就好比打开驿站的钥匙。驿站要开始营业，第一件事就是打开门锁，而 Broker 启动做的第一件事就是：`初始化 BrokerController`，其核心的源码在这里：

```java
public class BrokerStartup {
    public static Properties properties = null;
    public static CommandLine commandLine = null;
    public static String configFile = null;
    public static InternalLogger log;

    public static void main(String[] args) {
        //创建BrokerController
        start(createBrokerController(args));
    }
}
```

`createBrokerController(args)` 会将 BrokerController 给**实例化**出来，然后调用其内部依赖的各个组件的 `start()` 方法将其启动起来，然后 Broker 就可以使用了，非常符合咱们“三板斧”的操作。





#### 2.1.1 初始化 CommandLine

CommandLine 的作用是用于解析、存储传入的命令行参数的类。我们在启动 Broker 之前配置了一堆的配置项，而 Broker 要启动则必须要知道我们配置的内容，因为其运行是依赖这些配置的。存储的具体是什么命令呢？大家还记得本地启动 Broker 时，我们加的 `-c /Users/leonsh/rocketmqnamesrv/conf/broker.conf`。类似这样的配置，就会暂时被解析到 CommandLine 当中去。

![image-20240504003922220](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240504003922220.png)

关键的内容在 **options** 中，它是一个数组，里面可以存放**多个 option**，拿 broker.conf 配置文件来举例子。

- **opt**：代表参数名字**缩写**，例如 `-c`。
- **longOpt**：代表较为**完整的参数名**，例如我们知道在 IDEA 的 Configurations 中配置的 `-c` 全称为 `configFile`。
- **values**：则代表 `broker.conf` 配置文件的路径。



#### 2.1.2 基于 CommandLine 生成多个配置类

CommandLine 可以理解为解析配置文件的元数据，例如对 Broker 的配置 broker.conf 这种，但 CommandLine 中只有路径，并没有详细的配置内容，接下来还需要将这些元数据转换成详细数据。

![image-20240504112804714](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240504112804714.png)

上图中有了 broker.conf 的详细地址之后，就需要去磁盘上读取详细内容再解析到相应的配置类中，代码如下：

```java
// 源码位置:
// 子项目: broker
// 包名: org.apache.rocketmq.broker;
// 文件: BrokerStartup
// 行数: 115
if (commandLine.hasOption('c')) {
    //获取文件名称
    String file = commandLine.getOptionValue('c');
    if (file != null) {
        configFile = file;
        //获取输入流
        InputStream in = new BufferedInputStream(new FileInputStream(file));
        properties = new Properties();
        //读取到properties文件中
        properties.load(in);

        properties2SystemEnv(properties);
        //生成brokerConfig配置文件
        MixAll.properties2Object(properties, brokerConfig);
        MixAll.properties2Object(properties, nettyServerConfig);
        MixAll.properties2Object(properties, nettyClientConfig);
        MixAll.properties2Object(properties, messageStoreConfig);

        BrokerPathConfigHelper.setBrokerConfigPath(file);
        in.close();
    }
}
```

- 当且仅当我们配置了 -c 这个 Program Arguments 之后才会执行这个读取详细内容、并执行解析成配置文件的逻辑；
- 从 `broker.conf` 中解析出了两个配置文件，分别是：BrokerConfig、MessageStoreConfig；





#### 2.1.3 对 ROCKETMQ_HOME 的校验

Broker 将配置文件解析出来之后，还需要对其中的内容进行校验，判断传入的值是否合法，比如对 ROCKETMQ_HOME 的校验。

```java
// 源码位置:
// 子项目: broker
// 包名: org.apache.rocketmq.broker;
// 文件: BrokerStartup
// 行数: 136
if (null == brokerConfig.getRocketmqHome()) {
    System.out.printf("Please set the %s variable in your environment to match the location of the RocketMQ installation", MixAll.ROCKETMQ_HOME_ENV);
    System.exit(-2);
}
```

- 可以看到，如果 BrokerConfig 文件中没有设置 ROCKETMQ_HOME，会直接调用 System.exit(-2)，表示程序异常退出，这也是为啥我们之前没有配置时运行 Broker 直接报错。



#### 2.1.4 多 NameServer 的配置校验

在实际生产环境中会部署多台 NameServer 来组成一个集群对外提供服务，以此来保障“大脑”自身的高可用，但大家应该还记得，前面章节中给出的设置 NameServer 的代码却是这样的：

```java
producer.setNamesrvAddr("127.0.0.1:9876");
```

说好的**多个 NameServer** 呢？这不是只有一个吗？实际上从配置层面来说，RocketMQ 是支持的，我们来看：

```java
// 源码位置:
// 子项目: broker
// 包名: org.apache.rocketmq.broker;
// 文件: BrokerStartup
// 行数: 141
String namesrvAddr = brokerConfig.getNamesrvAddr();
if (null != namesrvAddr) {
    try {
        String[] addrArray = namesrvAddr.split(";");
        for (String addr : addrArray) {
            RemotingUtil.string2SocketAddress(addr);
        }
    } catch (Exception e) {
        System.out.printf(
            "The Name Server Address[%s] illegal, please set it as follows, \"127.0.0.1:9876;192.168.0.1:9876\"%n",
            namesrvAddr);
        System.exit(-3);
    }
}
```

- 其实看了源码你会发现，上面的逻辑非常简单、易懂。包括在打印日常日志都已经告诉我们了，如果我们要配置多个 NameServer，则需要将多个地址用 `;` 连接起来；
- 其实这里并不是在做解析，因为你会发现 `RemotingUtil.string2SocketAddress(addr);` 的返回值根本没有被用到；
- 这里实际上是在做**校验**，通过 `RemoteUtil` 中的一些初始化校验逻辑来检查传入值的合法性；



#### 2.1.5 实例化 BrokerController

到此就会通过构造函数，将 BrokerController 这把钥匙给实例化出来：

```java
// 源码位置:
// 包名: org.apache.rocketmq.broker;
// 文件: BrokerStartup
// 行数: 212
final BrokerController controller = new BrokerController(
    brokerConfig,
    nettyServerConfig,
    nettyClientConfig,
    messageStoreConfig);
```

- 核心配置 **BrokerConfig**、**MessageStoreConfig** 都被当作入参传给了 BrokerController；
- 在 BrokerController 的构造函数中，还会将许多依赖的组件进行初始化：TopicConfigManager、ConsumerOffsetManager 等；



### 2.2 初始化 BrokerController 的各项依赖

在上面的流程中，我们将 BrokerController 实例化出来，但 BrokerController 中仍然有一些配置没有加载、变量没有赋值。所以在后续的流程之前，还需要将这些配置、变量给搞定。



初始化的入口：

```java
// 源码位置:
// 子项目: broker
// 包名: org.apache.rocketmq.broker;
// 文件: BrokerStartup
// 行数: 220
boolean initResult = controller.initialize();
```



#### 2.2.1 从磁盘加载数据

因为 Broker 可能不是第一次启动，可能它之前已经运行过一段时间了，Broker 之前的运行数据会存储在磁盘上。所以，在启动时需要先去加载这部分数据：

```java
public boolean initialize() throws CloneNotSupportedException {
    boolean result = this.topicConfigManager.load();

    result = result && this.consumerOffsetManager.load();
    result = result && this.subscriptionGroupManager.load();
    result = result && this.consumerFilterManager.load();
    //...
}
```

- 通过名字还是很容易能够看出来是在加载什么内容。比如 `topicConfigManager` ，就是加载关于 Topic 相关的配置。`consumerOffsetManager` 即加载消费者消费进度管理的相关数据。每个 Manager 负责从磁盘加载自己负责的维度内数据，**每个 Manager 对应着磁盘上的一个文件**。



那 Broker 怎么知道文件在磁盘哪里？我们在 broker.conf 中配置的 storePathRootDir 配置项

```xml
storePathRootDir=/home/ztztdata/rocketmq-all-4.1.0-incubating/store
```

- 此目录就是 Broker 运行时产生的数据存储目录，这些文件就存储在我们特定的目录 store 中。



如果是 Broker 首次启动，那么就会将这些文件生成好：

```shell
.
├── consumerFilter.json
├── consumerFilter.json.bak
├── consumerOffset.json
├── consumerOffset.json.bak
├── delayOffset.json
├── delayOffset.json.bak
└── topics.json

0 directories, 7 files
```

用 TopicConfigManager 举例，它对应着 `rocketmqnamesrv/store/config/topic.json` 文件，它里面存储了所有 Topic 的配置，比如当前这个 Topic 是否是顺序消费、权限是啥、读写 MessageQueue 的数量是多少等等。



#### 2.2.2 Processor 初始化

当 BrokerController 启动后，就要处理客户端的消息，比如 Consumer 的消费，那么在处理过程中会使用到**线程池**来并发地处理某些操作，提高系统的运行效率，同时**减少了不停地创建、销毁线程所带来的开销**。除此之外，还会启动一些跟依赖组件相关的**定时任务**，这部分逻辑我们就不在此赘述，我们来把重点放在 **Processor** 上。

做后端开发的同学应该比较容易理解 Processor 的概念，就例如咱们开发一个 HTTP 接口，一个 Path 需要对应一个 Handler 一样：

![image-20240504132844576](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240504132844576.png)



这个 Processor 就是 **Broker 中处理不同请求的 Handler**，它是在这里被初始化的：

```java
// 源码位置:
// 子项目: broker
// 包名: org.apache.rocketmq.broker;
// 文件: BrokerController
// 行数: 349
this.registerProcessor();
```



Producer 在投递 Message 时就会发送请求到 Broker，Broker 也是在 registerProcessor 方法中**注册**对其处理逻辑的：

```java
this.remotingServer.registerProcessor(RequestCode.SEND_MESSAGE_V2, sendProcessor, this.sendMessageExecutor);
```

这里总共传入了三个参数：

- **requestCode**：用于识别不同类型、不同版本的请求，Producer 发送投递消息请求的 RequestCode 就是 SEND_MESSAGE_V2；
- **processor**：上面代码中的 sendProcessor，是处理请求的核心类；
- **executor**：最后一个参数是在处理请求时，会执行一些并发任务，此时会使用到上一步骤中提到的线程池；



### 2.3 启动 BrokerController 中的各个组件

当一切准备工作就绪之后，就准备调用 start 方法，Broker 就会正式对 Producer、Consumer 提供服务了。在这里面会调用 BrokerController 当中初始化好的一些变量，组件的 start 方法，将它们全部启动起来。

```java
 public static void main(String[] args) {
        start(createBrokerController(args));
    }

    public static BrokerController start(BrokerController controller) {
        try {
            controller.start();
            //....
        }
    }
}

// 源码位置:
// 包名: org.apache.rocketmq.broker;
// 文件: BrokerController
// 行数: 858
public void start() throws Exception {
    if (this.messageStore != null) {
        this.messageStore.start();
    }

    if (this.remotingServer != null) {
        this.remotingServer.start();
    }

    if (this.fastRemotingServer != null) {
        this.fastRemotingServer.start();
    }

    if (this.fileWatchService != null) {
        this.fileWatchService.start();
    }
  //......
}
```

- 这就好像咱们为家里配置智能家居，对 BrokerController 的初始化就对应着打开所有智能电器的开关、添加设备、蓝牙配对......之类的操作，而这里的 `start()` 启动 Broker 就相当于在手机上按下一键启动（假设有这么个功能，手动狗头），然后所有智能电器都开始正常地工作。
- 比如第一个初始化的是 **MessageStore**，这个依赖相当**核心**，它是用于 Message 的**存储、管理的依赖**，**消息持久化**就是由此组件完成的。关键组件我们会在后续进行讲解，大家现在只需要知道这里启动了很多的依赖即可。





### 三、总结

这里的启动逻辑我们用了很多的文字去描述，但其实总结下来就几个步骤：

- 读取用户指定的配置并解析；
- 验证这些配置项的合法性；
- 将核心组件 BrokerController 给实例化出来；
- 启动实例化好的 BrokerController 及其依赖的相关组件；

