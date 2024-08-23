# ConsumerQueue 的初始化



## 一、ConsumerQueue

ConsumerQueue 是能够快速定位 Message 而创建的索引，当 Consumer 来找 Broker 消费 Message 时，就能通过 ConsumerQueue 索引快速定位到 Message。



### 1.1 ConsumeQueue 结构

一条 ConsumeQueue 记录总共 20 个字节，共由 3 个部分组成：

![ConsumeQueue记录](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240514211643698.png)

- **物理偏移量**：占 8 个字节，即在 **CommitLog 文件当中的实际偏移量**；

- **消息体长度**：占 4 个字节，代表索引指向的这条 **Message 的长度**；

- **Tag 哈希值**：占 8 个字节，这个是 RocketMQ 消息过滤的原理，在 Broker 侧消费 Message 时，即可根据 Consumer 指定的 Tag 来对消息进行过滤；



上面只代表一条 ConsumQueue 记录，一条 ConsumQueue 记录和一条 Message 一一对应，实际生产中会有多条 ConsumeQueue 记录。所以，为了更好地组织管理它们，Broker 也有专门的目录、文件来存储 ConsumeQueue 记录：

![image-20240514213402190](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240514213402190.png)

一个 ConsumeQueue 文件中会包含 30 万条 ConsumeQueue 记录，而每条记录长度为 20 字节，那么一个 ConsumeQueue 文件的大小就为 `20 * 300000 = 6000000`，即约等于 `6000000 / 1024 / 1024`，也就是大约 5.72M。



RocketMQ 对于每条 20 字节的定义如下：

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: ConsumeQueue
// 行数: 35
public static final int CQ_STORE_UNIT_SIZE = 20;
```



至于对于每个 ConsumeQueue 文件包含 30 万条记录，则是在 MessageStoreConfig 当中定义的：

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store.config;
// 文件: MessageStoreConfig
// 行数: 44
private int mappedFileSizeConsumeQueue = 300000 * ConsumeQueue.CQ_STORE_UNIT_SIZE;
```



### 1.2 ConsumeQueue 文件存储

ConsumeQueue 文件存储的位置其实在 broker.conf 中配置过了：

```properties
storePathConsumeQueue = /Users/leonsh/rocketmqnamesrv/store/consumequeue
```

- 所有的 ConsumeQueue 文件都会存储在配置文件指定的目录中，这也更加印证了 `broker.conf` 的核心地位，很多关键的配置都是由它来指定的。



ConsumeQueue 文件在磁盘上的分布情况的实例，对于一个有 4 个 MessageQueue 的 ConsumeQueue 存储，如下所示：

```powershell
└── TopicTest
    ├── 0
    │   └── 00000000000000000000
    ├── 1
    │   └── 00000000000000000000
    ├── 2
    │   └── 00000000000000000000
    └── 3
        └── 00000000000000000000
```

可以看到，其目录组织是根据 Topic + MessageQueue 来的，每一个 MessageQueue 都是一个单独的目录，命名则是 MessageQueue 的 ID，每个目录会存在多个 ConsumeQueue 文件。

这样组织文件是有道理的。从 Producer 视角来看，Message 被投入到了某个具体的 MessageQueue。那么后续 Consumer 来消费时也要从对应的 MessageQueue 消费 Message，从抽象的层面来说是非常符合逻辑的（尽管我们知道实际存储时 CommitLog 并没有做这个区分）。

那为什么 MessageQueue 这一层还需要生成目录，而不是直接就生成一个 ConsumeQueue 文件呢？

这是因为，**RocketMQ 是支持千万级别消息堆积**的，所以在 Message 量大的情况下，一个 ConsumeQueue 文件无法存下所有 Message 的索引的。

前面讲过，一个 ConsumeQueue 文件只能存储 30 万条 ConsumeQueue 记录，即对应 30 万条 Message，而在实际的生产环境，Message 的量级远远大于 30 万。所以超出了这个限制之后，就会在对应的 MessageQueue 目录下再生成新的 ConsumeQueue 文件。其命名的规则与 CommitLog 是类似的，也是按照起始偏移量。



## 二、创建 ConsumeQueue

ConsumeQueue 的生成是在 Message 写入到 CommitLog 落袋为安之后，才为这些 Message 生成它们的取件码。



### 2.1 生成 ConsumeQueue 的组件

Broker 中执行这个光荣任务的组件是：ReputMessageService

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: DefaultMessageStore
// 行数: 1991
class ReputMessageService extends ServiceThread {
}
```



它是随着 MessageStore 组件的初始化而初始化，随着 MessageStore 的启动而启动，启动代码如下：

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: DefaultMessageStore
// 行数: 278
this.reputMessageService.start();
```

并且，整个业务的运行 对其依赖还是非常强，所以对其实时性的要求也比较高。像别的定时任务都是几百毫秒执行一次，它居然 **1 毫秒执行一次**，由此可见一斑。



### 2.2 生成取件码

ReputMessageService 要生成取件码，自然需要依赖 CommitLog 中的相关数据，否则 ConsumeQueue 当中的物理偏移量、消息体长度、Tag 哈希值从何而来？

所以，它会找到 **CommitLog**，更准确来说是底层的 MappedFile 来获取数据，这里拿到的是一个映射到内存当中的 Buffer，方便数据处理。有了源数据，接下来就需要对数据进行加工处理。而进行加工它是外包给了其他组件来完成的，这个组件名称叫：**CommitLogDispatcherBuildConsumeQueue**，负责构建 ConsumeQueue 记录，如下图所示：

![image-20240514231416894](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240514231416894.png)

在 ReputMessageService 中，会将从 CommitLog 拿到的数据通过 checkMessageAndReturnSize 方法打包成 **DispatchRequest**，将其通过 **CommitLogDispatcher** 分发出去。

在 **CommitLogDispatchBuildConsumeQueue** 收到分发的 DispatchRequest 之后，会调用 putMessagePositionInfo 方法，其中会根据 Topic、MessageQueueID 来查询对应的 ConsumeQueue 文件是否存在，如果没有存在的话就进行创建。

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: DefaultMessageStore
// 行数: 1544
public void putMessagePositionInfo(DispatchRequest dispatchRequest) {
  ConsumeQueue cq = this.findConsumeQueue(dispatchRequest.getTopic(), dispatchRequest.getQueueId());
  cq.putMessagePositionInfoWrapper(dispatchRequest, checkMultiDispatchQueue(dispatchRequest));
}
```

这部分检查、创建文件的逻辑和 CommitLog 是类似的，找到了 ConsumeQueue 文件之后，下面自然就是往文件中写入数据了：


![image-20240514233354723](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240514233354723.png)

值得注意的是，这里写 ConsumeQueue 也是写到 Buffer 中，不是和磁盘直接打交道：

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: ConsumeQueue
// 行数: 478
private boolean putMessagePositionInfo(final long offset, final int size, final long tagsCode, final long cqOffset) {
  //......
  this.byteBufferIndex.flip();
  this.byteBufferIndex.limit(CQ_STORE_UNIT_SIZE);
  // 物理偏移量
  this.byteBufferIndex.putLong(offset);
  // 消息体长度
  this.byteBufferIndex.putInt(size);
  // Tag 的哈希值
  this.byteBufferIndex.putLong(tagsCode);
	// CQ_STORE_UNIT_SIZE 即为 20
  final long expectLogicOffset = cqOffset * CQ_STORE_UNIT_SIZE;
  //......
}
```

上面的核心代码就是将物理偏移量、消息体长度、Tag 哈希值等数据给存储起来的地方。这里涉及到一些对 ByteBuffer 的操作，ByteBuffer 可以分为两种模式：读模式和写模式，而 `flip()` 则是将 ByteBuffer 切换成读模式，`limit()` 可以理解为当前可读取的 ByteBuffer 最大的长度，这里限制成了 CQ_STORE_UNIT_SIZE，即一条 ConsumeQueue 的大小，而 putLong、putInt 则就是单纯地写入数据，区别就是 putLong 会占用 8 字节，而 putInt 会占用 4 个字节。



