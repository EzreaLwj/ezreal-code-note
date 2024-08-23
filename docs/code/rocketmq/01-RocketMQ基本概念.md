#  RocketMQ 基本概念



## 一、基本介绍

这篇文章会介绍 RocketMQ 的核心概念，例如：**Topic**、**Broker**、**NameServer**、**MessageQueue** 等，会一步一图、层层递进的方式来介绍，在**熟悉每个组件**的前提下，同时**对 RocketMQ 拥有一个全局的视角**。



## 二、基本组件



### 2.1 Broker：消息队列的核心

Broker 可以说是**核心中的核心**，它负责接收 Producer 发送过来的 Message，并持久化起来，同时负责处理 Consumer 的消费请求。下图提到完整的工作流程：**投递 Message**、**存储 Message**、**处理消费请求**等，Broker 都参与了。

![img](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/1712670924553-59d708cc-50ba-4f80-ae7d-ead607f81d5a.png)

当然，任何的框架、服务，只要是单节点部署就会有这个问题。所以，为了保证整个架构的高可用，RocketMQ 会部署多台 Broker 组成一个集群对外提供服务：

![img](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/1712672117741-ae5f5092-c36d-49a7-bb86-caa4bf515c79.png)



Producer 生产的消息会分布式存储在这些 Broker 上。

> 分布式存储：大家应该都有存钱在银行，假设 A 银行、B 银行都有存，那么 A 和 B 银行中的存款全部加起来，就是你的总存款。



消息队列的消息也是同理，消息分散存储在多台 Broker 上，每台 Broker 实际上存储的消息内容是不同的，将这些 Broker 存储的消息全部加起来就是全部的数据。

![img](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/1712673806006-e774f417-d8c5-4196-9c51-6988aa17d211.png)

有的同学看到这里可能又会有问题了：“既然每台 Broker 存储的消息不同，那如果某台 Broker 突然整个挂了，这部分消息不就丢失了吗？就这还高可用呢？”



### 2.2 Topic：消息的组织者

如果 RocketMQ 真是这样设计的，那的确会有问题。当然，实际上肯定不是这样搞的。在 RocketMQ 中有 **Topic** 的概念：**表示 一类或者一大类消息的集合**。



举个例子，假设某个 Topic 中存的全是跟订单相关的，那么里面的消息就可能是：订单已创建、订单已更新、订单已付款诸如此类的消息。

并且，**Topic 在 RocketMQ 底层设计中其实是一个抽象的概念。Producer 在生产消息时，会指定将 Message 投递到某个 Topic，Consumer 消费消息时，也会指定一个 Topic 进行消费**：

![img](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/1712675879562-39506031-7035-4d14-a2cf-54001658b8c5.png)

这个时候，对于 Producer、Consumer 来说，消息队列就是一个黑盒，它们只关心投递 Message 到指定 Topic，再从指定 Topic 消费，其余的一概不关心。



但其实上面的图画得不是很准确，因为我们从上图中能够分析出一个结论：一个 Topic 只会存储在一台 Broker 上。你可以思考一下，真的是这样吗？

当然不是，这个结论是**错误的**。这里我们从两个方面论证一下。

- 第一个方面，假设 Topic A 和 Topic C 的 Message 体量在业务上非常小，而 Topic B 的数据量非常大，那么就会导致 Broker 的负载、存储压力都更大，导致严重的数据倾斜问题。
- 第二个方面，这样的设计不具备高可用性，当 Broker B 意外宕机，也就意味着 Topic B 中的 Message 会全部丢失。

所以，为了让大家更好地了解正确的底层原理，我们还需要引入新的组件来帮助我们解惑。





### 2.3 MessageQueue：对 Topic 的再次细分

我们简单举一个例子：假设 Topic A 这个 Topic，它有 3 个 MessageQueue，ID 分别为 0、1、2，那么用图来表示大概就是这样：

![img](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/1712677686297-a16faf99-6a8b-4ae2-86dc-6dc219b10ba3.png)



分散的 MessageQueue 一起组成了一个完整的 Topic。同 Topic 一样，MessageQueue 也是一个逻辑上的概念，可以把它理解为对底层存储的抽象。

MessageQueue 的消息 Message 最终会被存储在 Broker 所在机器的磁盘上，那里才是 Message 的最终归宿，如下图所示：

![img](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/1712678105948-df0205c2-0fe5-4e92-bdb8-3991dc62fe81.png)



了解了 MessageQueue 的概念之后，同一个 Topic 下的 Message 会分散存储在各个 Broker 上，**一来能够最大程度地进行容灾**，**二来能够防止数据倾斜**。这下鸡蛋不在一个篮子里了，数据被较为均匀地分摊了出去，出现数据倾斜的概率也大大降低了。



不过眼尖的同学可能发现了：“就算是引入了 MessageQueue 让数据分散存储了，Broker B 如果挂了，数据该丢还得丢啊，之前只丢一个 Topic 的 Message，现在倒好，3 个 Topic 的数据都会丢。“

但实际上，RocketMQ 4.5 版本之前提供了基于**主从架构的高可用机制**。即将 Broker 安装角色分为 Master Broker 和 Slave Broker，**主从之间会定期地进行数据同步**。

![RocketMQ主从同步](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240410103922016.png)



在 RocketMQ 4.5 之后，RocketMQ 提供了高可用集群的实现 —— Dledger，上面讲的主从架构虽然能够做到主从之间的数据同步，但 Master Broker 挂了还是会让集群、数据受损，并且需要人工将 Slave Broker 切换成 Master Broker，然后集群才能正常提供服务。Dledger 也会在发生故障时进行自动切换，其使用 Raft 协议重新选举出一个新的 Broker 重新对外提供服务，不需要人工介入。



我们言归正传，上面引出了 MessageQueue 的概念之后，我们看似已经解决了所有的问题。但很遗憾，这只是一个假象，从**概念**上的确自洽了，但如果我们把上面的架构代入到真实的开发场景下，就会很容易发现问题。

例如，这里有多台 Broker 组成一个集群在对外提供服务，当 Producer 来建立连接时，应该选择哪台 Broker 呢？

![image-20240410105857316](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240410105857316.png)



目标 Broker 的 IP 地址是要 Hard Code 到项目的配置文件吗？如果真是这么配置了，那配置的这台 Broker 突然挂掉了呢？难道我们还要去改项目的配置文件吗？这明显是不靠谱的做法，就算是做成动态配置不用重新发布服务，那也需要一定时间修改、等待生效。万一它抽风凌晨挂了呢？真要是凌晨应该还好，怕就怕它在业务最高峰期突然挂掉。

所以，为了回答这个问题，我们还需要继续引入新的组件 —— NameServer。



### 2.4 NameServer：RocketMQ 集群的大脑

NameServer 用于存储整个 RocketMQ 集群的元数据，就像 Kafka 会采用 Zookeeper 来存储、管理集群的元数据一样。

NameServer 中存放的元数据大概就是：

- 集群里都有哪些 Topic？
- 这些 Topic 的 MessageQueue 分别在哪些 Broker 上？
- 集群中都有哪些活跃的 Broker？

那 NameServer 都是怎么知道这些信息的呢？这些信息不会凭空出现在 NameServer 中，毕竟说到底它也只是个服务。当然是 Producer、Consumer、Broker 自行将数据注册到 NameServer 的。

Broker 在启动时会将自己注册到 NameServer 上，并且通过心跳的方式持续更新元数据。此外 Producer、Consumer 都会和 NameServer 建立连接、进行交互来动态地获取集群中的数据，这样就知道自己该连接哪个 Broker 了。

![NameServer](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240410114711817.png)



**生产环境中，会部署多台 NameServer 组成一个集群对外提供服务。**

![NameServer集群](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240410114800625.png)



NameServer 可以理解成一个无状态节点。

看到这你可能会问：这里面不是存储了很多元数据吗？咋还能算无状态节点呢？这是因为 Broker 会将自己注册到每一个 NameServer 上，每一个 NameServer 实例上都有完整的数据，所以可以将这一堆 NameServer 看成是一个无状态的大单体应用。这样的多副本部署保证了 RocketMQ 中扮演大脑角色的 NameServer 的高可用



## 三、总结



到这里，关于 RocketMQ 的简单架构原理就介绍完了，我们简单了解了 Broker、Topic、MessageQueue 和 NameServer，这些组件按照一定的节奏、互相配合，驱动 RocketMQ 精准地运行。

对于 Topic，在 RocketMQ 的底层设计中它是一个逻辑上的概念，而面对用户，它却是一个实打实的需要关注的概念。生产时需要关心，消费时也需要关心。对于 Topic，你可以理解为 RocketMQ 将底层负责的存储、调度的相关设计给封装起来，让我们在使用的同时不用去关心过多的其他概念。

对于 Broker，它将从 Topic 中细分出来的 MessageQueue 分布式地存储在多台实例上。而 NameServer 则是整个 RocketMQ 集群的大脑，它几乎什么都知道，并且 NameServer 通过多实例的部署保证了自身的高可用。

总之，希望你在简单熟悉了各个组件的同时，又能对 RocketMQ 的整体架构有了一个较为清晰的视角。这样我们在后续深入学习时，就能更加得心应手。







