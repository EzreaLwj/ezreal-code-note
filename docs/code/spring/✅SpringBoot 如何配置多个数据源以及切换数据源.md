
## 一、SpringBoot 配置多个数据源

在 pom.xml 中引入依赖 
```xml
<dependency>
   <groupId>com.baomidou</groupId>
   <artifactId>dynamic-datasource-spring-boot-starter</artifactId>
   <version>3.5.0</version>
</dependency>
```

然后再 application.yml 中配置多个数据源信息<br />![image.png](https://cdn.nlark.com/yuque/0/2024/png/27416797/1711209338799-0ad4cd63-decf-4d6f-8d61-6a10696e1b32.png#averageHue=%23332c2b&clientId=uc604c025-f0b0-4&from=paste&height=370&id=uac35fb0c&originHeight=463&originWidth=1045&originalType=binary&ratio=1.25&rotation=0&showTitle=false&size=105681&status=done&style=none&taskId=ueb38d157-dcac-4cfa-a7e6-2d33ac06f90&title=&width=836)<br />最后在对应的实现类中加入 @DS 注解

参考文章：<br />[【精·超详细】SpringBoot 配置多个数据源（连接多个数据库）_springboot连接多个数据源-CSDN博客](https://blog.csdn.net/qq_34469175/article/details/128039343)
## 二、动态切换数据源
继承 AbstractRoutingDataSource，然后重写 determineCurrentLookupKey 方法
```java
/**
 * 动态数据库源
 * @author Ezreal
 * @Date 2023/12/27
 */
public class DynamicDataSource extends AbstractRoutingDataSource {

    @Resource
    private DbRouterContextHolder dbRouterContextHolder;

    @Override
    protected Object determineCurrentLookupKey() {
        return "db" + dbRouterContextHolder.getDbIdx();
    }

}

```

- 可以通过 ThreadLocal 存储相应的值然后在方法中进行改变。

解析后的数据源会存放在 resolvedDataSources 这个 map 集合中
```java
public abstract class AbstractRoutingDataSource extends AbstractDataSource implements InitializingBean {

@Nullable
private Map<Object, DataSource> resolvedDataSources;

@Nullable
private DataSource resolvedDefaultDataSource;

    protected DataSource determineTargetDataSource() {
        Assert.notNull(this.resolvedDataSources, "DataSource router not initialized");
        Object lookupKey = determineCurrentLookupKey();
        // 获取配置的数据源
        DataSource dataSource = this.resolvedDataSources.get(lookupKey);
        //如果为空就使用默认的数据源
        if (dataSource == null && (this.lenientFallback || lookupKey == null)) {
            dataSource = this.resolvedDefaultDataSource;
        }
        if (dataSource == null) {
            throw new IllegalStateException("Cannot determine target DataSource for lookup key [" + lookupKey + "]");
        }
        //否则就返回我们配置的数据源
        return dataSource;
    }
}
```
	
