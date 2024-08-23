# PageHelper 实现原理

## 一、PageHelper 的使用
在 SpringBoot 中引入对应的 starter：
```xml
<dependency>
    <groupId>com.github.pagehelper</groupId>
    <artifactId>pagehelper-spring-boot-starter</artifactId>
    <version>1.3.0</version>
</dependency>

```

在查询数据时，在查询方法前添加上 PageHelper 的 start 方法即可：
```java
@Test
public void select() {
    PageHelper.startPage(1, 10);
    List<Order> orders = orderMapper.queryAll();
    log.info("记录条数为：{}", orders.size());
}
```
通过 PageHelper 分页插件，可以快速的帮助我们实现分页，我们不用在 sql 语句中使用 limit 来手动分页了。

## 二、PageHelper 实现原理
### 2.1 使用 ThreadLocal 记录分页参数
在调用 `startPage` 方法时，会通过 ThreadLocal 存储当前分页参数：
```java
public static <E> Page<E> startPage(int pageNum, int pageSize, boolean count, Boolean reasonable, Boolean pageSizeZero) {
    Page<E> page = new Page<E>(pageNum, pageSize, count);
    page.setReasonable(reasonable);
    page.setPageSizeZero(pageSizeZero);
    //当已经执行过orderBy的时候
    Page<E> oldPage = getLocalPage();
    if (oldPage != null && oldPage.isOrderByOnly()) {
        page.setOrderBy(oldPage.getOrderBy());
    }
    //设置ThreadLocal
    setLocalPage(page);
    return page;
}
```

### 2.2 使用 Mybatis 拦截器机制
这里先介绍一下 Mybatis 拦截器机制。
Mybatis 的拦截器机制是指用户可以自定义拦截器，通过代理的方式，增强 Mybatis 中的核心组件，目前只支持 4 个核心组件：**ParameterHandler**、**ResultSetHandler**、**StatementHandler** 和 **Executor**。
通过 **Interceptor** 接口可以实现自定义拦截器：
```java
public interface Interceptor {

    Object intercept(Invocation invocation) throws Throwable;
    // 默认方法
    default Object plugin(Object target) {
    return Plugin.wrap(target, this);
    }

    default void setProperties(Properties properties) {
    // NOP
    }
}
```

在 Configuration 初始化配置时，XMLConfigBuilder 会在配置文件中读取 对应的 Interceptor：
```java
private void pluginElement(XNode parent) throws Exception {
    if (parent != null) {
      for (XNode child : parent.getChildren()) {
        //解析Interceptor
        String interceptor = child.getStringAttribute("interceptor");
        Properties properties = child.getChildrenAsProperties();
        Interceptor interceptorInstance = (Interceptor) resolveClass(interceptor).getDeclaredConstructor().newInstance();
        interceptorInstance.setProperties(properties);
        
        configuration.addInterceptor(interceptorInstance);
      }
    }
  }
```

- 最终所有配置好的 interceptor 会被添加到  InterceptorChain 的 List 集合中；

在创建这4个核心对象后，InterceptorChain  都会尝试执行 pluginAll 方法 是否需要创建代理对象增强该类：
```java
//创建ParameterHandler
public ParameterHandler newParameterHandler(MappedStatement mappedStatement, Object parameterObject, BoundSql boundSql) {
    ParameterHandler parameterHandler = mappedStatement.getLang().createParameterHandler(mappedStatement, parameterObject, boundSql);
    parameterHandler = (ParameterHandler) interceptorChain.pluginAll(parameterHandler);
    return parameterHandler;
}
// 创建ResultSetHandler
public ResultSetHandler newResultSetHandler(Executor executor, MappedStatement mappedStatement, RowBounds rowBounds, ParameterHandler parameterHandler,
  ResultHandler resultHandler, BoundSql boundSql) {
    ResultSetHandler resultSetHandler = new DefaultResultSetHandler(executor, mappedStatement, parameterHandler, resultHandler, boundSql, rowBounds);
    resultSetHandler = (ResultSetHandler) interceptorChain.pluginAll(resultSetHandler);
    return resultSetHandler;
}
//创建StatementHandler
public StatementHandler newStatementHandler(Executor executor, MappedStatement mappedStatement, Object parameterObject, RowBounds rowBounds, ResultHandler resultHandler, BoundSql boundSql) {
    StatementHandler statementHandler = new RoutingStatementHandler(executor, mappedStatement, parameterObject, rowBounds, resultHandler, boundSql);
    statementHandler = (StatementHandler) interceptorChain.pluginAll(statementHandler);
    return statementHandler;
}
//创建Executor
public Executor newExecutor(Transaction transaction, ExecutorType executorType) {
    executorType = executorType == null ? defaultExecutorType : executorType;
    executorType = executorType == null ? ExecutorType.SIMPLE : executorType;
    Executor executor;
    if (ExecutorType.BATCH == executorType) {
      executor = new BatchExecutor(this, transaction);
    } else if (ExecutorType.REUSE == executorType) {
      executor = new ReuseExecutor(this, transaction);
    } else {
      executor = new SimpleExecutor(this, transaction);
    }
    if (cacheEnabled) {
      executor = new CachingExecutor(executor);
    }
    executor = (Executor) interceptorChain.pluginAll(executor);
    return executor;
}
```

在 InterceptorChain 的pluginAll 方法，中会调用 Interceptor 接口的默认方法 plugin 方法进行判断：
```java
public Object pluginAll(Object target) {
    for (Interceptor interceptor : interceptors) {
      target = interceptor.plugin(target);
    }
    return target;
}
```
我们再看看 plugin 方法，实则是调用 Plugin 的 wrap 方法：
```java
default Object plugin(Object target) {
    return Plugin.wrap(target, this);
}
```

Plugin 的 wrap 方法如下：
```java
public static Object wrap(Object target, Interceptor interceptor) {
    
    Map<Class<?>, Set<Method>> signatureMap = getSignatureMap(interceptor);
    Class<?> type = target.getClass();
    Class<?>[] interfaces = getAllInterfaces(type, signatureMap);
    if (interfaces.length > 0) {
      return Proxy.newProxyInstance(
          type.getClassLoader(),
          interfaces,
          new Plugin(target, interceptor, signatureMap));
    }
    return target;
  }
```

- 先获取 Interceptor 注解上的参数，比如 class 类，方法名称，方法参数，这三个参数可以准确获取某个类的某个方法；
- 接着判断当前的 Interceptor  是否符合当前类，如果符合就去创建代理对象；
- signatureMap 的 key 是类的对象，value 是该类对象中的方法 set 集合；

在 Plugin 的 Invoke 方法中：
```java
@Override
public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
    try {
      Set<Method> methods = signatureMap.get(method.getDeclaringClass());
      if (methods != null && methods.contains(method)) {
        return interceptor.intercept(new Invocation(target, method, args));
      }
      return method.invoke(target, args);
    } catch (Exception e) {
      throw ExceptionUtil.unwrapThrowable(e);
    }
}
```

- 先判断当前方法是不是存在于 Set 集合中，如果存在就执行 interceptor 的 intercept 方法，如果不存在就执行原方法；

### 2.3 PageHelper 自定义 Mybatis 拦截器类
PageHelper 自定义的拦截器 PageInterceptor 类中，会调用 _ExecutorUtil_ 类的 _**pageQuery**_ 方法去执行分页操作
```java
@Intercepts(
        {
                @Signature(type = Executor.class, method = "query", args = {MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class}),
                @Signature(type = Executor.class, method = "query", args = {MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class, CacheKey.class, BoundSql.class}),
        }
)
public class PageInterceptor implements Interceptor {
    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        try {
            //...
            List resultList;
            //调用方法判断是否需要进行分页，如果不需要，直接返回结果
            if (!dialect.skip(ms, parameter, rowBounds)) {
                //判断是否需要进行 count 查询
                if (dialect.beforeCount(ms, parameter, rowBounds)) {
                    //查询总数
                    Long count = count(executor, ms, parameter, rowBounds, null, boundSql);
                    //处理查询总数，返回 true 时继续分页查询，false 时直接返回
                    if (!dialect.afterCount(count, parameter, rowBounds)) {
                        //当查询总数为 0 时，直接返回空的结果
                        return dialect.afterPage(new ArrayList(), parameter, rowBounds);
                    }
                }
                // 进行分页处理
                resultList = ExecutorUtil.pageQuery(dialect, executor,
                        ms, parameter, rowBounds, resultHandler, boundSql, cacheKey);
            } else {
                //rowBounds用参数值，不使用分页插件处理时，仍然支持默认的内存分页
                resultList = executor.query(ms, parameter, rowBounds, resultHandler, cacheKey, boundSql);
            }
            return dialect.afterPage(resultList, parameter, rowBounds);
        } finally {
            if(dialect != null){
                dialect.afterAll();
            }
        }
    }
}
```

- 可见，它是针对 Executor 的 query 方法进行增强，目的是获取 BoundSql 类中的原 SQL。

ExecutorUtil.pageQuery 里面会调用抽象类 AbstractHelperDialect 类的 getPageSql 方法来实现对 BoundSql 中 sql 改写：
```java
public String getPageSql(MappedStatement ms, BoundSql boundSql, Object parameterObject, RowBounds rowBounds, CacheKey pageKey) {
    String sql = boundSql.getSql();
    //从ThreadLoacl中拿出分页参数
    Page page = getLocalPage();
    String orderBy = page.getOrderBy();
    if (StringUtil.isNotEmpty(orderBy)) {
        pageKey.update(orderBy);
        sql = OrderByParser.converToOrderBySql(sql, orderBy);
    }
    if (page.isOrderByOnly()) {
        return sql;
    }
    //调用子类的getPageSql方法
    return getPageSql(sql, page, pageKey);
}
```

但实际上进行改写的是实现类 MySqlDialect：
```java
@Override
public String getPageSql(String sql, Page page, CacheKey pageKey) {
    StringBuilder sqlBuilder = new StringBuilder(sql.length() + 14);
    sqlBuilder.append(sql);
    if (page.getStartRow() == 0) {
        sqlBuilder.append("\n LIMIT ? ");
    } else {
        sqlBuilder.append("\n LIMIT ?, ? ");
    }
    return sqlBuilder.toString();
}
```

- 可见上面的代码就是在原 SQL 中拼接分页参数
