# Broker 接收并存储 Message



## 一、背景

Broker 会接收到 Producer 发送过来的 Message，做一些处理之后将其存储起来，等待 Consumer 消费。可以把 Broker 类比成一个 HTTP 服务器，然后把 Producer 理解成一个浏览器，Producer 将请求发送给 Broker，Broker 负责处理，其实两者的角色就是客户端、服务器的关系。



## 二、初识 CommitLog

Broker 会把接收到 Message 存储到 CommitLog 中



### 2.1 CommitLog 存储机制

CommitLog 可以理解为存储 Message 的组件，其大概的存储流程如下：

![CommitLog存储](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240504193934664.png)

- 当某一个 CommitLog 写满后，会写入新的 CommitLog 中



在 Broker.conf 配置文件中，有个配置项叫 storePathCommitLog：

```xml
storePathCommitLog=/home/ztztdata/rocketmq-all-4.1.0-incubating/store/commitlog
```

- CommitLog 文件最终都会存储到配置文件指定的目录中

我们在本地查看生成的 CommitLog 文件
```java
.
├── 00000000000000000000
└── 00000000001073741824
```

- 文件名是一堆数字，这是因为其文件命名是按照文件`起始偏移量`来的。



## 三、Broker 处理投递 Message 请求

这些以起始偏移量命名的 CommitLog 都是由 Broker 在接收到 Message 之后生成出来的：

![CommitLog存储流程](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240504194648807.png)

至于具体怎么生成的，这些偏移量是怎么计算的，就是本小节要探索的重点。



### 3.1 从 Processor 开始

一切的一切都要从 Broker 收到 Producer 的请求开始，而说到 Broker 接受请求，就会想到 Processor。

在 Broker 启动的过程中，我们了解过 Broker 会调用 `registerProcessor()` 方法来**注册**各种各样的 ”Handler“，而处理 Producer 投递过来的消息的 Processor 类就在这里：

```java
public void registerProcessor() {
        /**
         * SendMessageProcessor
         */
        SendMessageProcessor sendProcessor = new SendMessageProcessor(this);
    //...
}
```

- SendMessageProcessor 就是处理 Producer 投递过来的消息的 Processor 类；



Producer 发送的投递消息请求，最终会由 asyncProcessorRequest 来进行处理：

```java
public class SendMessageProcessor extends AbstractSendMessageProcessor implements NettyRequestProcessor {

    private List<ConsumeMessageHook> consumeMessageHookList;
    
    @Override
    public void asyncProcessRequest(ChannelHandlerContext ctx, RemotingCommand request, RemotingResponseCallback responseCallback) throws Exception {
        //处理Message入口
        asyncProcessRequest(ctx, request).thenAcceptAsync(responseCallback::callback, this.brokerController.getPutMessageFutureExecutor());
    }
}
```

- Producer 投递 Message 指定的同步是指 Producer 需要同步地等待投递结果返回，而 `asyncProcessRequest` 则是 Broker 内部处理消息的方式，两者互相**不冲突**。



### 3.2 校验参数

校验逻辑广泛存在于 RocketMQ 各个组件的代码中，Broker 也不例外。在处理投递 Message 请求处理时，Broker 会对 Producer 客户端传入的 MessageQueue 做校验，代码入口在这里：

```java
// 源码位置:
// 子项目: broker
// 包名: org.apache.rocketmq.broker.processor;
// 文件: SendMessageProcessor
// 行数: 90
public CompletableFuture<RemotingCommand> asyncProcessRequest(ChannelHandlerContext ctx, RemotingCommand request){
   //...
  //处理Message入口
  return this.asyncSendMessage(ctx, request, mqtraceContext, requestHeader);
}

// 子项目: broker
// 包名: org.apache.rocketmq.broker.processor;
// 文件: SendMessageProcessor
// 行数: 267
 private CompletableFuture<RemotingCommand> asyncSendMessage(ChannelHandlerContext ctx, RemotingCommand request,
                                                                SendMessageContext mqtraceContext,
                                                                SendMessageRequestHeader requestHeader) {
     //...
     int queueIdInt = requestHeader.getQueueId();
    TopicConfig topicConfig = this.brokerController.getTopicConfigManager().selectTopicConfig(requestHeader.getTopic());

    if (queueIdInt < 0) {
        //随机选择，作为兜底
        queueIdInt = randomQueueId(topicConfig.getWriteQueueNums());
    }
    //...
 }
```

- 这里判断 Producer 选择的 MessageQueue 是否出现了非法的情况，比如 queueIdInt 小于 0，而这显然是不合法的。如果遇到不合法的情况，就会从当前的 Topic 的 WriteQueue 中随机选择一个作为兜底。



### 3.3 使用 MessageStore 写入数据

MessageStore 是负责消息存储的核心组件，Message 的存、取都是由它来完成，并且它也是 Broker 在 start 步骤启动的一个重要组件。

MessageStore 内部具体干活的方法是 `asyncPutMessage`，代码位置在这里：

```java
// 子项目: broker
// 包名: org.apache.rocketmq.broker.processor;
// 文件: SendMessageProcessor
// 行数: 327
putMessageResult = this.brokerController.getMessageStore().asyncPutMessage(msgInner);
```



而 asyncPutMessage 底层依赖的就是 CommitLog：

```java
public class DefaultMessageStore implements MessageStore {
    public CompletableFuture<PutMessageResult> asyncPutMessage(MessageExtBrokerInner msg) {
        //...
        CompletableFuture<PutMessageResult> putResultFuture = this.commitLog.asyncPutMessage(msg);
    }
}
```



用图来表示就是这样的：

![message处理流程](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240504214447084.png)

数据存储经过了层层的封装，现在交给了 CommitLog，它是属于 MessageStore 的一个组件，我们消息存储的原理探索就完成了，Message 最终会交给 CommitLog 持久化到磁盘。

梦想总是美好的，但 RocketMQ 底层实现远远没有那么简单。



深入到 CommitLog 的 asyncPutMessage 方法当中我们会发现，真正写入数据的操作在这里：

```java
public class CommitLog {
    public CompletableFuture<PutMessageResult> asyncPutMessage(final MessageExtBrokerInner msg) {
        // 源码位置:
        // 子项目: store
        // 包名: org.apache.rocketmq.store;
        // 文件: CommitLog
        // 行数: 667
        MappedFile mappedFile = this.mappedFileQueue.getLastMappedFile();
        if (null == mappedFile || mappedFile.isFull()) {
          mappedFile = this.mappedFileQueue.getLastMappedFile(0); // Mark: NewFile may be cause noise
        }
        // 行数: 683
        result = mappedFile.appendMessage(msg, this.appendMessageCallback, putMessageContext);
    }
}
```

- 存储的逻辑全在调用 MappedFile 





## 四、MappedFile 解析



### 4.1 什么是 MappedFile

CommitLog 在磁盘上生成的文件名不叫 CommitLog，而是已偏移量来命名的。所以严格来说，Message 并不是存储在 CommitLog 当中的，而是存储在这些以起始偏移量命名的文件当中的。而本小节探索的 MappedFile，就可以理解为**对磁盘文件的封装**：

![image-20240504221943168](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240504221943168.png)

一个 MappedFile 就对应了磁盘上的一个文件，而 CommitLog 中则持有、管理着所有的 MappedFile，这就是两者在逻辑上的关系。大家也可以抽象地把 CommitLog 理解成一个指向真实文件的**指针**，只不过它永远指向**正在写入**的那个文件。所以说，像”Message 最终会写入到 CommitLog 当中“这种说法，虽然是对的，但**不是很准确**。





### 4.2 管理零散的 MappedFile

一个 CommitLog 组件实际上可能对应多个文件，换句话说，会有多个 MappedFile。而 CommitLog 为了解决零散的 MappedFile 不好管理的问题，提供了 MappedFileQueue 来进行管理。

```java
public class MappedFileQueue {
    // 源码位置:
    // 子项目: store
    // 包名: org.apache.rocketmq.store;
    // 文件: MappedFileQueue
    // 行数: 43
    protected final CopyOnWriteArrayList<MappedFile> mappedFiles = new CopyOnWriteArrayList<MappedFile>();
    
    //获取数组的最后一个元素
    public MappedFile getLastMappedFile() {
      MappedFile mappedFileLast = null;

      while (!this.mappedFiles.isEmpty()) {
        try {
          // 可以看到, 就是直接获取的数组最后一个元素
          mappedFileLast = this.mappedFiles.get(this.mappedFiles.size() - 1);
          break;
        } catch (IndexOutOfBoundsException e) {
          //continue;
        } catch (Exception e) {
          log.error("getLastMappedFile has exception.", e);
          break;
        }
      }

      return mappedFileLast;
    }
}
```



再回到上面 CommitLog 中的代码会发现 CommitLog 是通过 this.mappedFileQueue.getLastMappedFile() 来获取当前的 MappedFile 的。结合 MappedFileQueue 底层是个数组，其实 getLastMappedFile 是获取数组的最后一个元素。

![image-20240504233856128](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240504233856128.png)





### 4.3 初始化 MappedFile

Broker 首次启动时是没有 MappedFile 的，所以在首次请求时拿到的 MappedFile 一定是 NULL，如果为空那么就会进行初始化：

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: CommitLog
// 行数: 675
if (null == mappedFile || mappedFile.isFull()) {
  mappedFile = this.mappedFileQueue.getLastMappedFile(0); // Mark: NewFile may be cause noise
}
```



可以看到，拿到的结果为空，或者文件写满了，都会执行 `this.mappedFileQueue.getLastMappedFile(0);` 这个逻辑来创建一个新的 MappedFile。没错，它虽然从命名上看是个获取类的操作，但实际上隐含了创建的操作在其中 ，核心的创建逻辑如下：

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: MappedFileQueue
// 行数: 200
// 这里的 startOffset 就是上面 getLastMappedFile(0) 当中的 0
public MappedFile getLastMappedFile(final long startOffset, boolean needCreate) {
  long createOffset = -1;
  // 首次启动, mappedFile 都是空的, 所以这里肯定拿不到东西
  MappedFile mappedFileLast = getLastMappedFile();

  if (mappedFileLast == null) {
    // 由于 startOffset 传入的是 0, 那么这里的 createOffset 算出来也是 0
    createOffset = startOffset - (startOffset % this.mappedFileSize);
  }

  // mappedFileLast 一定为 NULL, 所以这个逻辑不会走
  if (mappedFileLast != null && mappedFileLast.isFull()) {
    createOffset = mappedFileLast.getFileFromOffset() + this.mappedFileSize;
  }

  if (createOffset != -1 && needCreate) {
    // 调用核心方法, 创建 MappedFile
    return tryCreateMappedFile(createOffset);
  }

  return mappedFileLast;
}

```



### 4.4 确定 MappedFile 名称

我们来看看 tryCreateMappedFile 的代码逻辑：

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: MappedFileQueue
// 行数: 219
protected MappedFile tryCreateMappedFile(long createOffset) {
    String nextFilePath = this.storePath + File.separator + UtilAll.offset2FileName(createOffset);
    String nextNextFilePath = this.storePath + File.separator + UtilAll.offset2FileName(createOffset
            + this.mappedFileSize);
    return doCreateMappedFile(nextFilePath, nextNextFilePath);
}

protected MappedFile doCreateMappedFile(String nextFilePath, String nextNextFilePath) {
    MappedFile mappedFile = null;

    if (this.allocateMappedFileService != null) {
        mappedFile = this.allocateMappedFileService.putRequestAndReturnMappedFile(nextFilePath,
                nextNextFilePath, this.mappedFileSize);
    } else {
        try {
            mappedFile = new MappedFile(nextFilePath, this.mappedFileSize);
        } catch (IOException e) {
            log.error("create mappedFile exception", e);
        }
    }

    if (mappedFile != null) {
        if (this.mappedFiles.isEmpty()) {
            mappedFile.setFirstCreateInQueue(true);
        }
        this.mappedFiles.add(mappedFile);
    }

    return mappedFile;
}
```

这里对 MappedFile 进行初始化，即要在磁盘上创建文件了，既然要创建文件，我们需要知道文件的名字、创建的路径等。

从代码可以看出，最终文件的路径是由一个存储路径 **storePath**、**分隔符**和**一个偏移量**来计算的，如下图：

![image-20240504235819421](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240504235819421.png)

- storePath 就是咱们在 `broker.conf` 当中配置的专门存储 CommitLog 的目录。
- 分隔符不赘述了，就是个 `/`。
- `UtilAll.offset2FileName(createOffset);` 则会将给定的 `createOffset` 高位补 0 补到 20 位，比如这里 `createOffset` 的值是 0，那么补位的结果就是 `00000000000000000000`，最后将其转换成字符串就成为了 **CommitLog 文件的名称**。



所以，总结来说，这里会创建两个文件，分别是：

nextFilePath：代表当前创建的文件名；

```shell
/Users/leonsh/rocketmqnamesrv/data/commitlog/00000000000000000000
```

nextNextFilePath：从命名中的两个 Next 也能看出，是代表当前这个文件写满之后的下一个文件，Broker 会**预生成**下一个 CommitLog 文件。这样在上一个文件写满后，可以**减少这部分创建新文件的时间损耗**，快速地进行切换。

```shell
/Users/leonsh/rocketmqnamesrv/data/commitlog/00000000001073741824
```

可以看到，文件是符合之前讲的**通过起始偏移量来命名**的。第二个文件的 `1073741824` 其实就是 `1024 * 1024 * 1024 = 1073741824 = 1G`，也验证了一个 CommitLog 文件的大小是 1G。