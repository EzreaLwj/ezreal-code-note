# 准备寄送的货物——Message的构造细节



## 一、背景



接下来咱们可以通过投递 Message 这个 Demo 作为切入点来详细探索整个 RocketMQ 的架构了。其实 Message 的**发送**、**存储**、**消费**这个流程和咱们现实生活中的一个例子特别像，它就是`快递的收发、运输`。

![消息投递流程和快递业务进行对比](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/b3df18ae94e440f7ad2532b29b98dccf~tplv-k3u1fbpfcp-jj-mark:1512:0:0:0:q75.awebp)

Message 的组装可以类比为将货物装进一个纸箱子并且封好，将其发送给 Broker 则可以理解为快递的揽件、运输等流程。Broker 将消息存储起来就好像已经到达驿站了，那之后我们会收到通知去取快递，然后拆快递、取快递、拆快递就类似为 Consumer 消费消息。



## 二、了解 Message 的构造



```java
public class Message implements Serializable {
    private String topic;
    private int flag;
    private Map<String, String> properties;
    private byte[] body;
    private String transactionId;
    
    public Message(String topic, String tags, String keys, byte[] body) {
    	this(topic, tags, keys, 0, body, true);
    }
}
```

这个构造函数有四个参数：topic、tags、keys、body。可能大家对这个 keys 不是很了解，它是方便定位消息丢失问题的参数。只需要指定当前这个 Message 需要发到哪个 topic、message 要打上什么 tag、需不需要指定 keys，以及 message 是什么具体内容就可以了。

- topic 代表了地址；
- tag 表示消息的类型，类比于快递类型是啥？就像我们在寄件时，会让我们选择物品类型，是日用品？食品？又或者数码产品？
- body 就是我们消息的内容；



下面我们简要介绍一下这个 Message 类中的字段：

- `topic` 自不必多说，代表一类**消息的集合**，不在此赘述。
- `flag` 完全由我们在使用的时候自己设定，RocketMQ 并不关心，打开也可以理解为就是透传。
- `properties` 则可以放入一些特定的配置，本质上就是个 **Map**，至于里面都放什么数据，这个后续会讲。
- `body` 则是**消息体**，我们需要传递的实际内容就在这里了。那什么叫实际内容呢？就拿寄信举例子，我们需要去准备信封、邮票、写地址、封信封口，但真正关键的内容其实都在信里，而 `body` 就可以类比成信。
- `transactionId` 则是使用事务消息时的相关字段。



## 三、探索 Message 的构造函数



```java
public Message(String topic, String tags, String keys, int flag, byte[] body, boolean waitStoreMsgOK) {
    this.topic = topic;
    this.flag = flag;
    this.body = body;

    if (tags != null && tags.length() > 0)
        this.setTags(tags);

    if (keys != null && keys.length() > 0)
        this.setKeys(keys);

    this.setWaitStoreMsgOK(waitStoreMsgOK);
    
    public void setTags(String tags) {
        this.putProperty(MessageConst.PROPERTY_TAGS, tags);
    }
    public void setKeys(String keys) {
        this.putProperty(MessageConst.PROPERTY_KEYS, keys);
    }
    public void setWaitStoreMsgOK(boolean waitStoreMsgOK) {
        this.putProperty(MessageConst.PROPERTY_WAIT_STORE_MSG_OK, Boolean.toString(waitStoreMsgOK));
    }
}
```

- 可见，上面是通过 this.setTags(tags) 方法、 this.setKeys(keys) 方法、this.setWaitStoreMsgOK(waitStoreMsgOK) 方法来处理参数的，统一地将它们放入到 property 中。

