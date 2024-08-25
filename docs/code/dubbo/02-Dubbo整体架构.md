# 从全局视角俯瞰 Dubbo





## 一、背景

本文从 Dubbo 整体架构的视角出发，俯瞰 Dubbo 等等架构设计。本文将先从 Dubbo 的基本组成模块开始分析，然后不断拆分各个模块，最后带你形成对 Dubbo 由粗到细、由全局到细节的完整认知。



## 二、整体架构

![image-20240719103902394](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240719103902394.png)

Dubbo 由 4 个基本模块组成，分别为 Registry、Consumer、Provider 和 Monitor。

- **Registry**：注册中心，用于服务注册与发现。
- **Consumer**：服务消费者，远程服务的调用方。
- **Provider**：服务提供者，包装了服务实现，并暴露服务。
- **Monitor**：服务监控中心，用于统计服务的调用次数和调用时间等信息。





### 2.1 注册中心

注册中心，可以分为两个部分，一个是第三方存储介质，它支持存储服务信息和通知服务变更功能，像Zookeeper、Redis 等都可以作为注册中心。另一个是 Dubbo 框架中对注册中心的抽象，Dubbo 将注册中心抽象为以`Registry`为核心的注册中心组件，将这些组件引入到`Consumer`和`Provider`后，就可以执行注册中心的相关操作了，如**注册服务**、**订阅服务变更事件**和**通知服务变更**等。

![image-20240719110521546](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240719110521546.png)

- **Registry**：对注册中心的抽象，一个 Registry 就代表一个注册中心；
- **RegistryFactory**：注册中心工厂，用于在初始化时创建 Registry；
- **Directory**：服务目录，**用于保存和刷新可用于远程调用的 Invoker**，严格来说，服务目录是一个公用组件，它既可以划分到注册中心，也可以划分到下文中服务容错的模块里，因为这两个功能模块里都用到了`Directory`(服务目录)。
- **NotifyListener**：定义了通知接口，**此接口实现类用于接收服务变更的通知**。图中的 RegistryDirectory 实现类实现了 Directory 接口和 NotifyListener 即可，说明该类可以保存远程调用的 Invoker 功能，也能接收服务变更的信息。

通过以上核心组件，联合实现了注册中心相关的功能，如注册服务、订阅服务变更事件、通知服务变更和拉取服务信息等功能。



### 2.2 服务消费者

![image-20240719111642768](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240719111642768.png)

图中的**红色箭头表示初始化流程**，**绿色箭头表示发送请求流程**，**蓝色箭头表示接收响应结果流程**。

上图中，从两个角度剖析了服务消费者。一个是**从组成部分的角度**，将服务消费者拆分为 **Registry**、**Proxy**、**Protocol**、**Cluster**、**Invoker** 和 **Client** 六大组成部分。另一个是**从执行流程的角度**，将其分为**初始化**、**请求**和**响应**三步。

> 官网中，根据组件的定位将其分成了 10 层，拆分的很细。但是我感觉这里如果分的太细会比较琐碎，不好理解，因此我在这里将其分成了 6 个部分。在理解这样划分的基础上，再往更细粒度的拆分，也会更加简单。

- **Registry**：即注册中心，前文已经分析过了，通过`RegistryFactory`、`Registry`、`Directory`、`NotifyLisetener`联合实现注册中心相关的功能，包括`subscribe`、`register`、`lookup`、`notify`等。

- **Proxy**：**即服务代理，用于代理依赖的接口**。在使用过程中，通过`<dubbo:reference />`标签配置完依赖的接口后，就会生成一个代理。当调用接口时，实际上调用的是这个代理类。

- **Protocol**：**服务协议，它相当于一个中间层，用于封装 RPC 调用**。它在初始化时会创建用于远程调用的`Invoker`，并通过调用`Client`模块与服务端建立连接。

- **Cluster**：**服务集群，内部的主要功能是服务容错**。内部包括了`Cluster`、`ClusterInvoker`、`Directory`、`Router`和`LoadBalance`等组件。

- **Invoker**：**服务调用者**，其内部通过调用`Client`模块，完成与服务端的通讯(请求和响应)。

- **Client**：**客户端模块**，我将`Exchanger`、`Transporter`、`Client`、`Serialize`等组件全部都划到了客户端模块里，因为这些组件共同实现了connect（与服务端建立连接）、request（发送双向通讯请求）、send（发送单向通讯请求）和received（接收响应消息）等功能。



#### 2.2.1 初始化流程

初始化流程从 ReferenceConfig 发起，其最终目的是**生成 Proxy 服务代理**。过程中，先通过 Registry 注册中心订阅服务变更事件，并在第一次初始化时主动执行 notify 通知服务变更，通过 DubboProtocol 调用 Client 模块与服务端建立连接，并**生成 DubboInvoker**。同时**生成用于服务容错的 ClusterInvoker**。



#### 2.2.2 发送请求流程

当调用`<dubbo:reference />`标签配置的依赖的接口时，实际上是调用的`Proxy`域中的服务代理。

在调用过程中，Proxy 会通过 **Cluster 服务容错模块**调用 **DubboInvoker**，DubboInvoker 最终通过 Client 组件向服务提供者发送请求。其中**服务容错功能**由 **Directory**、**Route** 和 **LoadBalance** 等组件共同组合完成。DubboInvoker 在 发送请求之后会通过 AsyncToSyncInvoker 阻塞等待结果；Client 向服务提供者发送消息之前，要通过 Serialize 组件对请求消息进行编码。



#### 2.2.3 接收响应结果流程

服务提供者处理完请求后，会向服务提供者发送响应结果。服务消费者接收到响应数据后，先通过 Serialize 组件对响应消息解码，然后通过`ChannelHandler`组件**将响应结果分发到服务消费者的线程池**里，最终唤醒上一步阻塞等待结果的`AsyncToSyncInvoker`。最后，将响应结果返回给接口调用方。





### 2.3 服务提供者

![image-20240719121304252](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240719121304252.png)

和剖析服务消费者一样，这里也是从两个角度剖析了服务提供者。一个是**从组成部分的角度**，将服务提供者拆分为 **Registry**、Proxy、**Protocol**、**Invoker** 和 **Server** 五大组成部分。另一个是**从执行流程的角度**，将其分为**初始化**、**接收并处理请求**和**发送响应结果**三步。

1. 通讯模块，在服务消费者中叫 Client 模块，而在服务提供者中叫 Server 模块，里面的组件基本相同。
2. 服务消费者中有 Cluster 集群容错模块，而服务提供者中没有。
3. 在 Invoker 模块中，服务消费者中的`Invoker`是`DubboInvoker`，相对来说内容较多，封装了远程调用；服务提供者中的`Invoker`是`AbstractProxyInvoker`，内容较简单，用于调用本地生成的`Proxy`。
4. Proxy 模块中，服务消费者的配置类是`ReferenceConfig`，服务提供者的配置类是`ServiceConfig`。
5. Proxy 模块中，**服务消费者**的代理类**用于封装调用远程方法的细节**，**服务提供者**的代理类**用于调用本地实现类**



#### 2.3.1 初始化流程

服务提供者的初始化流程，是从 Proxy 模块中的`ServiceConfig`发起的。它首先通过 Protocol 模块调用Server 模块，启动服务；然后生成用于调用本地实现类的 Proxy，并创建用于调用 Proxy 的`AbstractProxyInvoker`；最后通过 **Registry 模块**，**将服务信息注册到注册中心**。

#### 2.3.2 接收并处理请求流程

服务提供者的 Server 接受到请求后，首先通过 Seralize 组件解码，然后交给 ChannelHandler 处理，在 ChannelHandler 的处理过程中，分发到 ThreadPool 中进行业务处理。

HeaderExchangeHandler 进行最终的业务处理调度，通过 ExchangeHandler 和 AbstractProxyInvoker **调用本地代理和本地实现**，并得到最终的业务处理结果。



#### 2.3.3 发送响应结果流程

`HeaderExchangeHandler`得到业务结果后，通过`Channel`向Server的对端（服务消费者）发送响应结果。在将响应结果发送到对端（服务消费者）之前，会通过`Seralize`组件对响应结果编码。

发送完成之后，就走到了前文中服务消费者接收响应结果流程。





## 三、总结

Dubbo 整体架构如下图所示：

![image-20240719124108365](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240719124108365.png)

从组成模块层面分析，Dubbo 包括注册中心、服务消费者、服务提供者和监控中心四大模块。注册中心包括两部分，一个是用于存储和通知服务信息的第三方存储媒介，另一个是 Dubbo 框架中抽象出的 Registry 模块。服务消费者由 Proxy、Protocol、Cluster、Invoker、Registry 和 Client 六大模块组成。服务提供者由 Proxy、Protocol、Invoker、Registry 和 Server 五大模块组成。

从整体的执行流程上分析：

- 服务**提供者初始化**，启动服务，生成本地服务代理，并**将服务注册到注册中心**里；
- 服务**消费者初始化**，连接服务提供者，**订阅服务注册中心中的变更事件**，接受服务变更通知，**生成远程调用的服务代理**；
- 服务消费者发送请求，经过**服务容错**、**远程调用**、**消息编码**等过程，将请求消息发送到服务提供者；
- 服务提供者接收请求，经过**消息解码**、**分发处理**、**调用本地实现**等过程，得到业务处理结果；
- 服务提供者得到业务处理结果后，将**响应消息编码**后，通过 Channel 将响应结果发送到服务消费者；
- 服务消费者接收响应结果，**解码响应结果**，唤醒远程调用的阻塞等待；
- 业务调用方得到最终的远程调用结果；
- 此外，在监控中心模块中，会定时将调度统计信息上送到监控中心。

