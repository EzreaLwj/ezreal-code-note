Mybatis 内置了三种数据源，分别是 **Pooled**、**Unpooled** 和 JNDI，其中 Pooled 数据源是具有连接池的。同时 Mybatis 也可以使用第三方的数据源：Druid、Hikari、C3P0 等。
![image.png](https://cdn.nlark.com/yuque/0/2024/png/27416797/1712500461437-16155665-8169-4a90-8567-b0dfdcfcf0bc.png#averageHue=%232f2f2f&clientId=uba104275-c78e-4&from=paste&height=436&id=uebfa1472&originHeight=545&originWidth=780&originalType=binary&ratio=1.25&rotation=0&showTitle=false&size=77188&status=done&style=none&taskId=uf44fb85a-d9aa-46ee-9d68-170a226e428&title=&width=624)

- 可以看到，在 Mybatis，会通过工厂模式获取对应的数据源。在执行 SQL 之前，Mybatis 会获取数据库连接 Connection，而此时获得的 Connection 则是应用的启动的时候，已经通过配置项中的文件加载到内存中。

源码实现
[06-数据源池化技术实现](https://www.yuque.com/ezrealwj/ny1ud5/og92obstsrcakk51?view=doc_embed)
