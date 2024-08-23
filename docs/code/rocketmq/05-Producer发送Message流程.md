# Message 的发送流程详解



## 一、背景

 Producer 的很多核心逻辑其实都在发送 Message 这个流程中，本章就深入探索一下 Message 的发送流程。



## 二、Message 发送流程



### 2.1 消息发送方式

Producer 总共有三种 Message 发送方式，分别时 **SYNC**，**ASYNC**，**ONEWAY**：

- **SYNC**：同步模式，Producer 将 Message 发送出去之后，会**等待 Broker 的返回**，然后再发送下一条消息。

- **ASYNC**：异步模式，Producer 发送消息就不会等待 Broker 的返回了，而是会通过**回调**的方式来处理 Broker 的响应。

- **ONEWAY**：单向模式，Producer 就只管发送消息，不会关心 Broker 的返回，也没有任何回调函数。不过相应的，由于不用处理返回结果，此模式的性能会非常好，类似于日志收集的场景可以考虑使用 `ONEWAY` 模式。



在 DefaultMQProducerImpl 类中，存在一个 send 方法，是用来发送消息的核心方法：

```java
public SendResult send(Message msg,
    long timeout) throws MQClientException, RemotingException, MQBrokerException, InterruptedException {
    return this.sendDefaultImpl(msg, CommunicationMode.SYNC, null, timeout);
}
```

- 绝大部分的场景下，Message 的发送采用的都是**同步**的方式，深入上面的 `send()` 方法我们会发现，这里是指定了采用 `CommunicationMode.SYNC` 模式来进行 Message 发送的；

总共有 4 个参数：

- `msg`：就是我们最开始打包好的 Message。
- `communicationMode`：发送模式的枚举类，其实就是刚刚讲过的 `SYNC`、`ASYNC`、`ONEWAY`。
- `sendCallback`：当 CommunicationMode 为 `ASYNC` 时，才会传入的回调函数。
- `timeout`：发送的超时时间，如果发送流程卡住了，Producer 不可能一直在这里等待，等到超过了指定的超时时间，就会抛出异常。



### 2.2 消息发送过程

消息的发送过程，全在 **DefaultMQProducerImpl** 类的 **sendDefaultImpl** 方法。

#### 2.2.1 校验 Message

```java
public static void checkMessage(Message msg, DefaultMQProducer defaultMQProducer)
    throws MQClientException {
    // 最基本的检查
    if (null == msg) {
        throw new MQClientException(ResponseCode.MESSAGE_ILLEGAL, "the message is null");
    }
    // 检查 Topic 是否合法
    Validators.checkTopic(msg.getTopic());
    Validators.isNotAllowedSendTopic(msg.getTopic());

    // 判断 body 字段是否是 nil
    if (null == msg.getBody()) {
        throw new MQClientException(ResponseCode.MESSAGE_ILLEGAL, "the message body is null");
    }
	// 判断 body 是否长度为 0 
    if (0 == msg.getBody().length) {
        throw new MQClientException(ResponseCode.MESSAGE_ILLEGAL, "the message body length is zero");
    }
    // 判断 body 的长度是否超过最大的长度, MaxMessageSize 默认是 4M
    if (msg.getBody().length > defaultMQProducer.getMaxMessageSize()) {
        throw new MQClientException(ResponseCode.MESSAGE_ILLEGAL,
            "the message body size over max value, MAX: " + defaultMQProducer.getMaxMessageSize());
    }
}
```

- 不知道你是否发现这些代码像极了我们平时写的业务代码，在收到一个 Request 的时候，需要先做非常多的校验。所以你看到了，RocketMQ 这么优秀、高级的框架也会有这种业务代码。所以在面对一个框架或者业务时，大家不要有畏难的情绪，此时我们要做的事情很简单：找到切入点，从切入点开始，慢慢地、扎实地向其核心稳步推进。





#### 2.2.2 获取 Topic 详情

包裹经历了安检，排除掉了危险的因素之后才可以继续执行后续的流程。目前我们只知道 Topic 的名称，其他相关的详情一概不知。不知道详情则无法对内容进行校验。所以，这里我们还需要**通过 Topic 名称去 NameServer 换取详情**。



RocketMQ 中定义了 **TopicPublishInfo** 来描述 Topic 的相关数据：

```java
public class TopicPublishInfo {
    private boolean orderTopic = false;
    private boolean haveTopicRouterInfo = false;
    private List<MessageQueue> messageQueueList = new ArrayList<MessageQueue>();
    private volatile ThreadLocalIndex sendWhichQueue = new ThreadLocalIndex();
    private TopicRouteData topicRouteData;
}
```

- 主要的核心部分有两块：**Topic 的路由数据**和 **MessageQueue 列表**；
- 路由数据又分为 QueueData 列表和 BrokerData 列表，里面分别存储了某台 Broker 下的 MessageQueue 数量、Broker 本身的元数据。



其中 messageQueueList 存储了某个 Topic 下的所有 MessageQueue 

![MessageQueueList](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240503165324841.png)

而 QueueData 存储的是选择好的 MessageQueue，BrokerData 则是存储选择好的 Broker 信息。

![MessageQueue](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240503165522779.png)

![BrokerData](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240503165546074.png)

#### 2.2.3 高级特性之消息重投

消息重投是 RocketMQ **自带的**、**在投递消息失败的情况下**的**重试**机制。该机制能够**最大限度**地保证消息的成功投递，并保证消息不丢失。但很多事情都有两面性，这里也不例外。在享受消息重投带来成功投递保障的同时，在**某些极端情况下**也可能会导致**消息重复**的问题。



比如 Producer 这边以为投递失败了，但是实际上可能只是响应超时导致了报错，Message 实际上已经成功存储在了 Broker 上，此时再进行重试就会导致重复。消息重投会重投多少次呢？我们看看代码：

```java
int timesTotal = communicationMode == CommunicationMode.SYNC ? 1 +this.defaultMQProducer.getRetryTimesWhenSendFailed() : 1;
```

- communicationMode 默认都是 SYNC，所以重试次数为 1 + this.defaultMQProducer.getRetryTimesWhenSendFailed()，其中 retryTimesWhenSendFailed 的值为 2，总次数为 3 次；

- 上面的 timesTotal 严格来说**并不代表重投次数**，而是**总的投递次数**，因为无论怎么样，始终都会发送一次，所以留给重试的次数就只有 2 次；



#### 2.2.4 选择 MessageQueue

有了 Topic，知道了所有的 MessageQueue 列表，接下来就需要从 MessageQueue 当中选择一个，这块的逻辑我们会在后续单独讲，大家现在只需要知道会从所有的 MessageQueue 中选一个出来即可。

```java
MessageQueue mqSelected = this.selectOneMessageQueue(topicPublishInfo, lastBrokerName);
```



#### 2.2.5 消息发送

我们现在知道了 Topic 的详细信息，也知道了往哪个 MessageQueue 投递消息，接下来就到了真正发送消息的逻辑，调用 DefaultMQProducerImpl 的 sendKernelImpl 方法。

```java
sendResult = this.sendKernelImpl(msg, mq, communicationMode, sendCallback, topicPublishInfo, timeout - costTime);
```



**首先尝试对 message 进行压缩**

```java
private boolean tryToCompressMessage(final Message msg) {
    if (msg instanceof MessageBatch) {
        //batch dose not support compressing right now
        return false;
    }
    byte[] body = msg.getBody();
    if (body != null) {
        if (body.length >= this.defaultMQProducer.getCompressMsgBodyOverHowmuch()) {
            try {
                byte[] data = UtilAll.compress(body, zipCompressLevel);
                if (data != null) {
                    msg.setBody(data);
                    return true;
                }
            } catch (IOException e) {
                log.error("tryToCompressMessage exception", e);
                log.warn(msg.toString());
            }
        }
    }

    return false;
}
```

- 这里有一个前置条件，只有 message 大于 compressMsgBodyOverHowmuch 才会进行压缩，默认是 4K





**接着构造 Message 的请求 Header**

投递 Message 是 Producer 针对 Broker 的一个请求，可以内容抽象为两大类：请求头和请求体。请求体就是 Message 本身，请求头中包含了各种必要的数据，比如发送到哪个 Topic，发送到哪个 MessageQueue 等。

投递 Message 对应的请求体是 **SendMessageRequestHeader**：

```java
SendMessageRequestHeader requestHeader = new SendMessageRequestHeader();

requestHeader.setProducerGroup(this.defaultMQProducer.getProducerGroup());
requestHeader.setTopic(msg.getTopic());
requestHeader.setDefaultTopic(this.defaultMQProducer.getCreateTopicKey());
requestHeader.setDefaultTopicQueueNums(this.defaultMQProducer.getDefaultTopicQueueNums());
requestHeader.setQueueId(mq.getQueueId());
requestHeader.setSysFlag(sysFlag);
requestHeader.setBornTimestamp(System.currentTimeMillis());
requestHeader.setFlag(msg.getFlag());
requestHeader.setProperties(MessageDecoder.messageProperties2String(msg.getProperties()));
requestHeader.setReconsumeTimes(0);
requestHeader.setUnitMode(this.isUnitMode());
requestHeader.setBatch(msg instanceof MessageBatch);
```



这里列举一下 SendMessageRequestHeader 的关键参数：

![image-20240503133838556](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240503133838556.png)

关键参数有：producerGroup、topic、defaultTopicQueueNums、queueId、sysFlag、bornTimestamp、properties 等，这些参数，在后续 Message 到了 Broker 之后还会用到。而这里后续就是调用底层的 Netty 进行网络通信，将 Message 发送出去了。



## 三、Producer 发送 Message 源码

```java
// DefaultMQProducerImpl类下的 sendDefaultImpl方法
private SendResult sendDefaultImpl(
    Message msg,
    final CommunicationMode communicationMode,
    final SendCallback sendCallback,
    final long timeout
) throws MQClientException, RemotingException, MQBrokerException, InterruptedException {
    this.makeSureStateOK();
    //检验Message是否合法
    Validators.checkMessage(msg, this.defaultMQProducer);
    final long invokeID = random.nextLong();
    long beginTimestampFirst = System.currentTimeMillis();
    long beginTimestampPrev = beginTimestampFirst;
    long endTimestamp = beginTimestampFirst;
    //获取Topic信息
    TopicPublishInfo topicPublishInfo = this.tryToFindTopicPublishInfo(msg.getTopic());
    if (topicPublishInfo != null && topicPublishInfo.ok()) {
        boolean callTimeout = false;
        MessageQueue mq = null;
        Exception exception = null;
        SendResult sendResult = null;
        //计算消息重投的次数
        int timesTotal = communicationMode == CommunicationMode.SYNC ? 1 + this.defaultMQProducer.getRetryTimesWhenSendFailed() : 1;
        int times = 0;
        String[] brokersSent = new String[timesTotal];
        for (; times < timesTotal; times++) {
            String lastBrokerName = null == mq ? null : mq.getBrokerName();
            //获取MessageQueue
            MessageQueue mqSelected = this.selectOneMessageQueue(topicPublishInfo, lastBrokerName);
            if (mqSelected != null) {
                mq = mqSelected;
                brokersSent[times] = mq.getBrokerName();
                try {
                    beginTimestampPrev = System.currentTimeMillis();
                    if (times > 0) {
                        //Reset topic with namespace during resend.
                        msg.setTopic(this.defaultMQProducer.withNamespace(msg.getTopic()));
                    }
                    long costTime = beginTimestampPrev - beginTimestampFirst;
                    if (timeout < costTime) {
                        callTimeout = true;
                        break;
                    }
					//调用核心的发送Message代码
                    sendResult = this.sendKernelImpl(msg, mq, communicationMode, sendCallback, topicPublishInfo, timeout - costTime);
                    endTimestamp = System.currentTimeMillis();
                    this.updateFaultItem(mq.getBrokerName(), endTimestamp - beginTimestampPrev, false);
                    switch (communicationMode) {
                        case ASYNC:
                            return null;
                        case ONEWAY:
                            return null;
                        case SYNC:
                            if (sendResult.getSendStatus() != SendStatus.SEND_OK) {
                                if (this.defaultMQProducer.isRetryAnotherBrokerWhenNotStoreOK()) {
                                    continue;
                                }
                            }

                            return sendResult;
                        default:
                            break;
                    }
                } catch (RemotingException e) {
                    endTimestamp = System.currentTimeMillis();
                    this.updateFaultItem(mq.getBrokerName(), endTimestamp - beginTimestampPrev, true);
                    log.warn(String.format("sendKernelImpl exception, resend at once, InvokeID: %s, RT: %sms, Broker: %s", invokeID, endTimestamp - beginTimestampPrev, mq), e);
                    log.warn(msg.toString());
                    exception = e;
                    continue;
                } catch (MQClientException e) {
                    endTimestamp = System.currentTimeMillis();
                    this.updateFaultItem(mq.getBrokerName(), endTimestamp - beginTimestampPrev, true);
                    log.warn(String.format("sendKernelImpl exception, resend at once, InvokeID: %s, RT: %sms, Broker: %s", invokeID, endTimestamp - beginTimestampPrev, mq), e);
                    log.warn(msg.toString());
                    exception = e;
                    continue;
                } catch (MQBrokerException e) {
                    endTimestamp = System.currentTimeMillis();
                    this.updateFaultItem(mq.getBrokerName(), endTimestamp - beginTimestampPrev, true);
                    log.warn(String.format("sendKernelImpl exception, resend at once, InvokeID: %s, RT: %sms, Broker: %s", invokeID, endTimestamp - beginTimestampPrev, mq), e);
                    log.warn(msg.toString());
                    exception = e;
                    switch (e.getResponseCode()) {
                        case ResponseCode.TOPIC_NOT_EXIST:
                        case ResponseCode.SERVICE_NOT_AVAILABLE:
                        case ResponseCode.SYSTEM_ERROR:
                        case ResponseCode.NO_PERMISSION:
                        case ResponseCode.NO_BUYER_ID:
                        case ResponseCode.NOT_IN_CURRENT_UNIT:
                            continue;
                        default:
                            if (sendResult != null) {
                                return sendResult;
                            }

                            throw e;
                    }
                } catch (InterruptedException e) {
                    endTimestamp = System.currentTimeMillis();
                    this.updateFaultItem(mq.getBrokerName(), endTimestamp - beginTimestampPrev, false);
                    log.warn(String.format("sendKernelImpl exception, throw exception, InvokeID: %s, RT: %sms, Broker: %s", invokeID, endTimestamp - beginTimestampPrev, mq), e);
                    log.warn(msg.toString());

                    log.warn("sendKernelImpl exception", e);
                    log.warn(msg.toString());
                    throw e;
                }
            } else {
                break;
            }
        }

        if (sendResult != null) {
            return sendResult;
        }

        String info = String.format("Send [%d] times, still failed, cost [%d]ms, Topic: %s, BrokersSent: %s",
            times,
            System.currentTimeMillis() - beginTimestampFirst,
            msg.getTopic(),
            Arrays.toString(brokersSent));

        info += FAQUrl.suggestTodo(FAQUrl.SEND_MSG_FAILED);

        MQClientException mqClientException = new MQClientException(info, exception);
        if (callTimeout) {
            throw new RemotingTooMuchRequestException("sendDefaultImpl call timeout");
        }

        if (exception instanceof MQBrokerException) {
            mqClientException.setResponseCode(((MQBrokerException) exception).getResponseCode());
        } else if (exception instanceof RemotingConnectException) {
            mqClientException.setResponseCode(ClientErrorCode.CONNECT_BROKER_EXCEPTION);
        } else if (exception instanceof RemotingTimeoutException) {
            mqClientException.setResponseCode(ClientErrorCode.ACCESS_BROKER_TIMEOUT);
        } else if (exception instanceof MQClientException) {
            mqClientException.setResponseCode(ClientErrorCode.BROKER_NOT_EXIST_EXCEPTION);
        }

        throw mqClientException;
    }

    validateNameServerSetting();

    throw new MQClientException("No route info of this topic: " + msg.getTopic() + FAQUrl.suggestTodo(FAQUrl.NO_TOPIC_ROUTE_INFO),
        null).setResponseCode(ClientErrorCode.NOT_FOUND_TOPIC_EXCEPTION);
}

```



DefaultMQProducerImpl 的 sendKernelImpl 方法



