# Mybatis 插件运行原理

## 一、实现原理
Mybatis 插件的运行原理主要涉及 3 个接口：Interceptor、Invocation 和 Plugin。

1. Interceptor：拦截器接口，定义了 Mybatis 插件的基本功能，包括插件的初始化、插件的拦截方法以及插件的销毁方法；
2. Invocation：调用接口，表示 Mybatis 在执行 SQL 语句时的状态，包括 SQL 语句，参数，返回值等信息；
3. Plugin：插件接口，Mybatis 框架在执行 SQL 语句时，会将所有**注册的插件（StatementHandler，ParameterHandler 等）**封装成 Plugin 对象，通过 Plugin 对象实现对 SQL 语句的拦截和修改（主要是 Plugin 对象实现了 InvocationHandler 代理接口）

插件运行流程：

1. 首先，Mybatis 框架运行时，会将所有实现了 Interceptor 接口的插件进行初始化；
2. 初始化后，Mybatis 框架会将所有的插件和原始的 Executor 对象封装成一个 InvocationChain 对象（这里使用的是责任链模式）；
3. 每次执行 SQL 语句时，Mybatis 框架都会通过 InvocationChain 对象依次调用所有插件的 intercept 方法，实现对 SQL 语句的拦截和修改；
4. 最后，Mybatis 框架会将修改后的 SQL 语句交给原始的 Executor 对象执行，并将执行结果返回给调用方。


## 二、PageHelper 分页原理
根本原理就是：ThreadLocal + Mybatis Plugin

当我们调用 PageHelper 的 startPage 方法时，其实 PageHelper 会把它们存储到 ThreadLocal 中。PageHelper 会在执行器的 query 方法执行之前，会从 ThreadLocal 中再获取分页参数信息，页码和页大小，然后执行分页算法。最后 PageHelper 会通过修改 SQL 语句的方式，在 SQL 后面动态拼接上 limit 语句，限定查询的数据范围，并且在查询结束后再清除 ThreadLocal 中的分页参数。
[PageHelper原理深度剖析（集成+源码） - 掘金](https://juejin.cn/post/6971797901907492895#heading-2)


## 三、插件机制源码分析
```java
public class InterceptorChain {

    private final List<Interceptor> interceptors = new ArrayList<>();

    public Object pluginAll(Object target) {
        for (Interceptor interceptor : interceptors) {
            target = interceptor.plugin(target);
        }
        return target;
    }

    public void addInterceptor(Interceptor interceptor) {
        interceptors.add(interceptor);
    }

    public List<Interceptor> getInterceptors(){
        return Collections.unmodifiableList(interceptors);
    }
}
```

- 通过调用 pluginAll 方法来调用所有拦截器的 plugin 方法，从而生成代理对象。Interceptor 的 plugin 方法其实是调用 Plugin 类的 wrap 方法来生成代理对象的。

在 Interceptor 接口中，定义了 plugin 的默认方法，调用 Plugin 的 wrap 方法来生成代理对象

```java
public interface Interceptor {

    // 拦截，使用方实现
    Object intercept(Invocation invocation) throws Throwable;

    // 代理
    default Object plugin(Object target) {
        return Plugin.wrap(target, this);
    }

    //设置属性
    default void setProperties(Properties properties) {
        //NOP
    }
}
```

再看看创建具体的使用，以 StatmentHandler 为例

```java
public StatementHandler newStatementHandler(Executor executor, MappedStatement mappedStatement, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, BoundSql boundSql) {
    // 创建语句处理器，Mybatis 这里加了路由 STATEMENT、PREPARED、CALLABLE 我们默认只根据预处理进行实例化
    StatementHandler statementHandler = new PreparedStatementHandler(executor, mappedStatement, parameter, rowBounds, resultHandler, boundSql);
    // 嵌入插件，代理对象
    statementHandler = (StatementHandler) interceptorChain.pluginAll(statementHandler);
    return statementHandler;
}
```
