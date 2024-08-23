# Message 落盘过程



## 一、落盘实现



### 1.1 核心落盘代码

```java
// 源码位置:
// 子项目: broker
// 包名: org.apache.rocketmq.broker;
// 文件: MappedFileQueue
// 行数: 226
protected MappedFile doCreateMappedFile(String nextFilePath, String nextNextFilePath) {
    MappedFile mappedFile = null;
	
    if (this.allocateMappedFileService != null) {
        //创建文件
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

- 文件的创建实际上是交给 AllocateMappedFileService 类的 putRequestAndReturnMappedFile 方法来执行的，而 MappedFileQueue 的作用实际上是将创建好的 MappedFile 类管理起来，将其加入到 mappedFiles 中。



我们来看看 AllocateMappedFileService 中 putRequestAndReturnMappedFile 方法的具体实现：

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: AllocateMappedFileService
// 行数: 51
public MappedFile putRequestAndReturnMappedFile(String nextFilePath, String nextNextFilePath, int fileSize) {
    
    //处理第一个MappedFile
    AllocateRequest nextReq = new AllocateRequest(nextFilePath, fileSize);
    boolean nextPutOK = this.requestTable.putIfAbsent(nextFilePath, nextReq) == null;
   
    boolean offerOK = this.requestQueue.offer(nextReq);
    
    //处理第二个MappedFile
    AllocateRequest nextNextReq = new AllocateRequest(nextNextFilePath, fileSize);
    boolean nextNextPutOK = this.requestTable.putIfAbsent(nextNextFilePath, nextNextReq) == null;
  
    boolean offerOK = this.requestQueue.offer(nextNextReq);
}
```

其实核心的操作就是向 requestQueue 和 requestTable 中写入数据。



### 1.2 基于内存队列创建文件

创建文件采用的是**内存队列**的方式，上面代码中的 `this.requestQueue` 就是一个内存队列，而 putRequestAndReturnMappedFile 的作用就是将**创建文件的请求**写入到 `this.requestQueue` 当中，而真正**处理请求**，**创建文件**的是在另一个地方。

内存队列也是消息队列的一种，那么既然是消息队列则其中必然有 Producer、Consumer。在这里，Producer 就是 AllocateMappedFileService，Consumer 是 AllocateMappedFileService。没错，还是它自己。



在 Broker 启动时，会在其 start 方法中调用 messageStore.start 方法来启动 MessageStore。在 MessageStore 初始化时（执行构造函数时）会启动一个线程：

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: DefaultMessageStore
// 行数: 74
public DefaultMessageStore(final MessageStoreConfig messageStoreConfig, final BrokerStatsManager brokerStatsManager, final MessageArrivingListener messageArrivingListener, final BrokerConfig brokerConfig) throws IOException {
  //......
  this.allocateMappedFileService.start();
  //......
}
```



它会调用 AllocateMappedFileService 的 run 方法

```java
public void run() {
    log.info(this.getServiceName() + " service started");

    while (!this.isStopped() && this.mmapOperation()) {

    }
    log.info(this.getServiceName() + " service end");
}
```



核心的处理逻辑其实是 mmapOperation 方法：

```java
// 源码位置:
// 包名: org.apache.rocketmq.store;
// 文件: AllocateMappedFileService
// 行数: 146
private boolean mmapOperation() {
  //......
  // 行数: 150
  req = this.requestQueue.take();
  AllocateRequest expectedRequest = this.requestTable.get(req.getFilePath());
  //......
}
```

- 这就是从内存队列中获取请求的情况，调用 requestQueue 的 take 方法，线程在这里阻塞，尝试从队列中获取到创建文件的请求对象。然后再从 AllocateRequest 对象中获取文件路径，最后从 requestTable 中获取到真正的请求对象。
- 拿到请求后就去尝试去创建 MappedFile 对象，并将其落库；

![异步处理创建MappedFile请求](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240508162018849.png)

简单来说就是八个字：**异步解耦**，**自产自销**。AllocateMappedFileService 既负责**向 queue 中写入请求对象**，又负责**启动线程定时去消费创建文件**的请求，利用到了消息队列中异步、解耦的特点。



### 1.3 通过 FileChannel 创建文件

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: AllocateMappedFileService
// 行数: 176
mappedFile = new MappedFile(req.getFilePath(), req.getFileSize());
```

- 这里的主要逻辑是**检查对应的文件目录是否存在**和**创建文件**。



如果我们在 broker.conf 中配置了一个不存在的路径，MappedFile 会帮我们创建出对应的文件路径：

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: MappedFile
// 行数: 95
private static void createDirIfNotExist(String dirName) {
    File f = new File(dirName);
    if (!f.exists()) {
        boolean result = f.mkdirs();
        log.info(dirName + " mkdir " + (result ? "OK" : "Failed"));
    }
}
```

`roker.conf` 中配置的路径在绝大多数情况下都是**多级目录**，所以这里使用的是 `java.io.File` 中的 `mkdirs()` 方法。还有个跟它类似的方法是 `mkdir()` ，两者的区别如下。

- `mkdir()`：只能创建**一级**目录，并且它的父目录必须存在。
- `mkdirs()`：可以创建**多级**目录，目录不存在也可以运行，它会创建不存在的父目录。



目录创建完毕后，就会通过 RandomAccessFile 对文件进行读取和写入操作，这里会将 FileChannel 保存下来，有了 FileChannel 之后，就可以对 CommitLog 中写入数据了。

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: MappedFile
// 行数: 162
private void init(final String fileName, final int fileSize) throws IOException {
    this.fileName = fileName;
    this.fileSize = fileSize;
    this.file = new File(fileName);
    this.fileFromOffset = Long.parseLong(this.file.getName());
    boolean ok = false;
	//检查目录
    ensureDirOK(this.file.getParent());

    try {
        //生成FileChannel类
        this.fileChannel = new RandomAccessFile(this.file, "rw").getChannel();
        //获取 MappedByteBuffer
        this.mappedByteBuffer = this.fileChannel.map(MapMode.READ_WRITE, 0, fileSize);
        TOTAL_MAPPED_VIRTUAL_MEMORY.addAndGet(fileSize);
        TOTAL_MAPPED_FILES.incrementAndGet();
        ok = true;
    } catch (FileNotFoundException e) {
        log.error("Failed to create file " + this.fileName, e);
        throw e;
    } catch (IOException e) {
        log.error("Failed to map file " + this.fileName, e);
        throw e;
    } finally {
        if (!ok && this.fileChannel != null) {
            this.fileChannel.close();
        }
    }
}
```

- **MappedByteBuffer** 的作用就是将创建好的 CommitLog 通过 FileChannel 的 map 方法**映射到内存**中，这样后续对 CommitLog 文件的修改可以直接操作内存，不用每次都用 IO 从磁盘获取数据，这是 RocketMQ 高性能的底层原理之一。

- MappedByteBuffer 被经常使用到的场景之一就是**大文件的高性能读写**，不仅仅是 **RocketMQ**，**Kafka** 也采用了 MappedByteBuffer 来处理其日志相关文件，通过 `mmap` 的方式，将对磁盘文件的 IO 操作变成了对内存地址的操作，大大提升了效率。



### 1.4 将 Message 写入到 CommitLog 中

写入 Message 的所有准备工作就已经完成了，接下来我们需要做的就是将 Message 写入到对应的 CommitLog 当中去。



#### 1.4.1 判断 MappedFile 大小

我们把视角切回到 MappedFile 实例化好、CommitLog 创建好之后的地方

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: CommitLog
// 行数: 667
MappedFile mappedFile = this.mappedFileQueue.getLastMappedFile();
```

这里拿到的 `mappedFile` 可能有两种情况：

1. 首次运行、并且刚刚创建好的新文件；
2. 已经运行过一段时间、写入过数据的文件。

如果是第 2 种情况，结合咱们前面讲过的文件写满 1G 之后会切换文件继续写，这里一定会有判断 MappedFile 大小的逻辑，这个代码在前面章节中其实也出现过：

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



`isFull()` 的判断逻辑非常简单：

```java
public boolean isFull() {
    return this.fileSize == this.wrotePosition.get();
}
```

this.wrotePosition 被原子操作类 AtomicInteger 封装的整数，代表当前数据要写入的下标，如果它和 this.filesize 的值相同，就说明文件已经被写满了。



#### 1.4.2 写入 Message 到 CommitLog

接下来就是将 Message 写入到 MappedByteBuffer 中，相关代码入口在这里：

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: CommitLog
// 行数: 683
result = mappedFile.appendMessage(msg, this.appendMessageCallback, putMessageContext);
```



appendMessage 方法底层调用的是 appendMessageInner 方法：

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: MappedFile
// 行数: 212
public AppendMessageResult appendMessagesInner(final MessageExt messageExt, final AppendMessageCallback cb,
            PutMessageContext putMessageContext) {
  int currentPos = this.wrotePosition.get();
  // 兜底措施
  if (currentPos < this.fileSize) {
    ByteBuffer byteBuffer = writeBuffer != null ? writeBuffer.slice() : this.mappedByteBuffer.slice();
    byteBuffer.position(currentPos);
    AppendMessageResult result;
    if (messageExt instanceof MessageExtBrokerInner) {
      // 将Message追加到文件末尾
      result = cb.doAppend(this.getFileFromOffset(), byteBuffer, this.fileSize - currentPos,
                           (MessageExtBrokerInner) messageExt, putMessageContext);
    } 
    //......
    // 更新下标
    this.wrotePosition.addAndGet(result.getWroteBytes());
    this.storeTimestamp = result.getStoreTimestamp();
    return result;
  }
  //......
}
```

可以看到，真正到了落库时，执行操作的还是 MappedFile。这里会先判断 `wrotePosition` 是否超过了当前文件的大小，前面已经通过 `isFull()` 判断过了，这里大家理解成一个兜底逻辑即可。

而 WriteBuffer 默认是 NULL，所以最终我们拿到的 Buffer 就是前面介绍的 MappedByteBuffer，然后调用 cb.doAppend 将 Message 追加到 Buffer 中，然后更新 wrotePosition。

![image-20240508172650453](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240508172650453.png)





#### 1.4.3 将 Buffer 刷入磁盘

负责这项工作的组件叫作 **FlushRealTimeService**，命名很明确，一目了然，此任务 500ms 执行一次，每次刷 4 页的数据到磁盘中，而每页大小为 4K，即每次都会刷 16K 的数据到磁盘中。

每次刷盘都会针对一个 MappedFile，而所有的 MappedFile 都由 MappedFileQueue 进行统一的管理，所以这里刷盘的接力棒会交到 MappedFileQueue 当中：

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: CommitLog
// 行数: 1102
CommitLog.this.mappedFileQueue.flush(flushPhysicQueueLeastPages);
```

之前从 MappedFileQueue 当中找 MappedFile 的逻辑很简单，直接取的数组最后一位元素。但这里不能这么做了，因为刷盘针对的 MappedFile 不一定是最后一个 MappedFile。

那我们依赖什么来定位 MappedFile？`当然是 Offset`，不然为什么 CommitLog 文件的命名会按照 Offset 的规律来呢？Broker 会通过 `flushedWhere` 变量来代表下次刷数据的 Offset，以此来找到对应的 MappedFile。代码如下所示：

```java
// 源码位置:
// 子项目: store
// 包名: org.apache.rocketmq.store;
// 文件: MappedFileQueue
// 行数: 489
int index = (int) ((offset / this.mappedFileSize) - (firstMappedFile.getFileFromOffset() / this.mappedFileSize));
MappedFile targetFile = null;
try {
  targetFile = this.mappedFiles.get(index);
} catch (Exception ignored) {
}

if (targetFile != null && offset >= targetFile.getFileFromOffset()
    && offset < targetFile.getFileFromOffset() + this.mappedFileSize) {
  return targetFile;
}

for (MappedFile tmpMappedFile : this.mappedFiles) {
  if (offset >= tmpMappedFile.getFileFromOffset()
      && offset < tmpMappedFile.getFileFromOffset() + this.mappedFileSize) {
    return tmpMappedFile;
  }
}
```

简单来说，这里会根据 `offset` 和当前 MappedFile 的起始偏移量来计算出对应的 MappedFile 文件在 MappedFileQueue 当中的下标。举个例子，假设 `offset` 是 876，那么计算公式就是 `((900 / 1073741824) - (0 / 1073741824)) = 0`，此时就会选中第一个 MappedFile。

而如果 `offset` 的值大于了 `this.mappedFileSize`，那么代入计算最终得出来的 `index` 就是 1，即选择第二个 MappedFile。

然后 RocketMQ 会对选中的 MappedFile 做最后的校验，来判断 `offset` 是不是真的在当前这个 MappedFile 当中。而最后的那个 `for` 循环，可以理解为究极兜底，即遍历所有的 MappedFile，判断 `offset` 是不是大于 MappedFile 的起始偏移量，并且小于 MappedFile 结束的偏移量。光说有点抽象，给大家看一幅图就明白了：

![image-20240508183650666](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240508183650666.png)

一图胜千言，其实上图已经表达得很清楚了。可以简单地理解为每个 MappedFile 都有自己的 Offset 范围，当前 `flushedWhere` 的值在哪个范围，就会取哪个 MappedFile；而且每次 Flush 完都会更新 `flushedWhere` 的值。

并且，为了提升刷盘的效率、节约资源，MappedFile 在真正执行 `flush()`之前，会先判断待刷的数据是否达到了 4 页，达到了才会执行刷盘操作，否则就不执行。
