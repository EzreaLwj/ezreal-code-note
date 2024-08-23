# Synchronized 锁升级原理分析



## 一、背景

在多线程并发编程中 synchronized 一直是元老级角色，很多人称呼它为重量级锁。但是，随着 JavaSe1.6 synchronized 进行了各种优化之后，有些情况下它就并不那么重了。



## 二、对象结构

在 HotSpot 虚拟机中，对象在堆内存的存储布局可以分为**对象头**，**实例数据**，**对齐填充部分**。

- **对象头**：包含两部分 **MarkWord** 和 **类型指针**；
- **实例数据**：存储对象中的字段信息，包括子类自行实现的字段和从父类继承下来的字段；
- **对齐填充**：起占位符的作用，HotSpot 虚拟机的自动内存管理系统要求对象起始地址必须是 8 字节的整数倍；

而 **synchronized** 的实现关键在于**对象头**中的 **MarkWord**，它存储着对象的 **hashcode**，**分代年龄**，**锁状态标识**，**线程持有的锁**，**偏向模式**，**线程 ID** 等信息，如下图：

![虚拟机对象头的MarkWord](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240213002423076.png)



## 三、锁优化原理



### 3.1 偏向锁

在并发编程中，某一把锁大部分时间可能只会被一个线程频繁访问，需要实现同步的场景较少。针对这种情况，JDK 对 synchronized 实现了偏向锁的功能。



当前线程第一次获取锁时，虚拟机会把对象头里的 **MarkWord** 中的**偏向模式设置为 1**，**锁标志位设置为 01**，同时**通过 CAS 操作把线程 ID 写入到 MarkWord 中**，如果 CAS 成功，则表示线程偏向成功。下次该线程访问该同步块时，只需要将该**线程 ID** 与 **MarkWord 中存储的线程 ID** 进行比较即可。

![MarkWord处理-偏向锁](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240214152008955.png)

如果 CAS 失败，则会**撤销偏向锁**，进入到无锁（"01"）或者轻量级锁（"00"）的状态。如果持有偏向锁的线程**不处于活动状态**，则**进入无锁状态**；如果**处于活动状态**，该线程就会遍历对象的锁记录，栈中的锁记录和对象头 MarkWord **要么重新偏向于其他线程**，要**么恢复到无锁**，**要么标记该对象不适合作为偏向锁**，进入到轻量级锁。



偏向锁的执行过程：

![偏向锁执行过程](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240214154800952.png)

在 Java 6 和 Java 7 中，偏向锁是默认启动的，可以通过 JVM 参数 -XX:-UseBiasedLocking 来控制偏向锁的开启与关闭。



### 3.2 轻量级锁

轻量级锁是 JDK 6 时加入的新型锁机制，它名字中的 "轻量级" 是相对于使用操作系统互斥量来实现的传统锁而言的，因此传统的锁机制就被称为 "重量级" 锁。



#### 3.2.1 轻量级锁加锁

线程在执行同步块之前，JVM 会在当前的**线程栈空间中创建一个锁记录（Lock Record）**。

![创建锁记录](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240214160604166.png)

同时会**将对象头中的 MarkWord 复制一份到当前的锁记录**中，称为 **Displaced MarkWord**，接着通过 CAS 将对象头中的 MarkWord 替换为锁记录的地址，**如果成功**，则**表示成功获取到锁**，**如果失败**，**则表示获取锁失败**，说明至少有一条线程与当前线程竞争获取该对象锁。虚拟机首先会检查当前 MarkWord 上面的 Lock Record 地址，如果是指向当前线程栈帧中的 Lock Record，则直接进入同步块执行，否则就说明这个锁对象被其他线程抢占了，那么将会采用**自旋的方式**获取锁或者**升级到重量级锁**。

> 如果升级为了重量级锁，那么当前等待锁的线程要进入等待队列中等待。

![交换MarkWord](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240214160936554.png)



#### 3.2.2 轻量级锁解锁

轻量级锁解锁时，会使用原子的 CAS 操作将 **Displaced Mark Word** 替换回到对象头，如果成功，则表示没有竞争发生，如果失败，表示当前锁存在竞争，锁就会膨胀为重量级锁。



#### 3.2.3 轻量级锁加解锁流程

![轻量级锁加锁流程](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240214164315419.png)



### 3.3 重量级锁

重量级锁的实现是基于监视器 Monitor，是由 JVM 提供的，由 C++ 实现，有三个实现部分：

- **WaitSet**：调用了 wait 方法的线程，在这里等待
- **EntrySet**：没有获取到锁的线程，在这里等待；
- **Owner**：获取到该锁的线程对象

Monitor 的实现属于重量级锁，涉及到内核态和用户态的切换，每个 Java 对象都会关联一个 Monitor 对象，如果使用 synchronized 给该对象加锁，那么 Java 上面的 **MarkWord 地址就被设置为指向该 Monitor 对象的指针**，**锁标识设置为 "10"**。

![Monitor结构](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240214165548363.png)



## 四、锁升级流程

偏向锁、轻量级锁的状态转化及对象 MarkWord 关系如下图：

![偏向锁、轻量级锁的状态转化及对象Mark Word的关系](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240213224256508.png)



轻量级锁及锁膨胀流程：

![image-20240214162452724](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240214162452724.png)





参考资料：

周志明 —— 《深入理解Java虚拟机》

方腾飞、魏鹏、程晓明 —— 《Java并发编程的艺术》