## 一、一级缓存

在**同一个会话 SqlSession **中，Mybatis 会将执行过的 SQL 语句的结果放入到缓存中，下次执行同样的 SQL 时会直接从缓存中获取。一级缓存是默认开启的。
一级缓存注意问题：

- 一级缓存内部设计简单，只是一个没有容量的 HashMap，在缓存功能上有所欠缺；
- 一级缓存最大的范围是同一个 SqlSession，有多个 SqlSession 或者分布式环境下，数据库写操作会引起脏数据。所以在分布式环境下不建议使用一级缓存，此时建议把缓存级别设定为 Statement；
## 二、一级缓存源码分析
在 Executor 的抽象实现类 BaseExecutor 中存在 PerpetualCache 类，该类其实是封装了一个 Map 对象：
（每一个 SqlSession 对象里面都会有一个 Executor 对象）
```java
public class PerpetualCache implements Cache {

    private Logger logger = LoggerFactory.getLogger(PerpetualCache.class);

    private String id;

    // 使用HashMap存放一级缓存数据，session 生命周期较短，正常情况下数据不会一直在缓存存放
    private Map<Object, Object> cache = new HashMap<>();
}
```

- 这个 Map 以 CacheKey 作为 key，结果集处理器返回的结果为 value ；

我们解释一下这个 CacheKey
```java
public class CacheKey implements Cloneable, Serializable {

    private static final long serialVersionUID = -3796671609418874673L;

    public static final CacheKey NULL_CACHE_KEY = new NullCacheKey();

    private static final int DEFAULT_MULTIRLTER = 37;

    private static final int DEFAULT_HASHCODE = 17;

    private int multiplier;

    private int hashcode;

    private long checksum;

    private int count;

    private List<Object> updateList;

    public CacheKey() {
        this.hashcode = DEFAULT_HASHCODE;
        this.multiplier = DEFAULT_MULTIRLTER;
        this.count = 0;
        this.updateList = new ArrayList<>();
    }

    public CacheKey(Object[] objects) {
        this();
        updateAll(objects);
    }

    public int getUpdateCount() {
        return updateList.size();
    }

    public void update(Object object) {
        // 计算Hash值，校验码
        int baseHashcode = object == null ? 1 : object.hashCode();
        count++;
        checksum += baseHashcode;
        baseHashcode *= count;

        hashcode = multiplier * hashcode + baseHashcode;
        updateList.add(object);
    }

    public void updateAll(Object[] objects) {
        for (Object o : objects) {
            update(o);
        }
    }

    @Override
    public boolean equals(Object object) {
        if (this == object) {
            return true;
        }

        if (!(object instanceof CacheKey)) {
            return false;
        }

        final CacheKey cacheKey = (CacheKey) object;
        if (hashcode != cacheKey.hashcode) {
            return false;
        }
        if (checksum != cacheKey.checksum) {
            return false;
        }
        if (count != cacheKey.count) {
            return false;
        }

        for (int i = 0; i < updateList.size(); i++) {
            Object thisObject = updateList.get(i);
            Object thatObject = cacheKey.updateList.get(i);
            if (thisObject == null) {
                if (thatObject == null) {
                    return false;
                }
            } else {
                if (!thisObject.equals(thatObject)) {
                    return false;
                }
            }
        }
        return true;
    }

    @Override
    public int hashCode() {
        return hashcode;
    }

    @Override
    public String toString() {
        StringBuilder returnValue = new StringBuilder().append(hashcode).append(':').append(checksum);
        for (Object obj : updateList) {
            returnValue.append(':').append(obj);
        }
        return returnValue.toString();
    }

    @Override
    protected Object clone() throws CloneNotSupportedException {
        CacheKey clonedCacheKey = (CacheKey) super.clone();
        clonedCacheKey.updateList = new ArrayList<>(updateList);
        return clonedCacheKey;
    }
}
```

- 可见，它根据 checksum，hashcode 等字段，重写了 equals 方法，自己定义了一套比较规则。
- 在实际中，我们根据 mappedStatementId + offset + limit + SQL + queryParams + environment 信息构建出一个哈希值，所以这里把这些对应的信息分别传递给 cacheKey#update 方法。

从而，我们在创建 CacheKey 时，需要使用到 MappedStatement , parameterObject, RowBounds , BoundSql 这 4 个属性：

```java
@Override
public CacheKey createCacheKey(MappedStatement ms, Object parameterObject, RowBounds rowBounds, BoundSql boundSql) {
    if (closed) {
        throw new RuntimeException("Executor was closed");
    }
    CacheKey cacheKey = new CacheKey();
    cacheKey.update(ms.getId());
    cacheKey.update(rowBounds.getOffset());
    cacheKey.update(rowBounds.getLimit());
    cacheKey.update(boundSql.getSql());
    List<ParameterMapping> parameterMappings = boundSql.getParameterMappings();
    TypeHandlerRegistry typeHandlerRegistry = ms.getConfiguration().getTypeHandlerRegistry();
    for (ParameterMapping parameterMapping : parameterMappings) {
        Object value;
        String propertyName = parameterMapping.getProperty();
        if (boundSql.hasAdditionalParameter(propertyName)) {
            value = boundSql.getAdditionalParameter(propertyName);
        } else if (parameterObject == null) {
            value = null;
        } else if (typeHandlerRegistry.hasTypeHandler(parameterObject.getClass())) {
            value = parameterObject;
        } else {
            MetaObject metaObject = configuration.newMetaObject(parameterObject);
            value = metaObject.getValue(propertyName);
        }
        cacheKey.update(value);
    }
    if (configuration.getEnvironment() != null) {
        cacheKey.update(configuration.getEnvironment().getId());
    }
    return cacheKey;
}
```

当创建完 CacheKey 后，我们就可以实现缓存的功能了：

```java
@Override
public <E> List<E> query(MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler) throws SQLException {
    //1.获取绑定SQL
    BoundSql boundSql = ms.getBoundSql(parameter);
    //2.创建缓存key
    CacheKey key = createCacheKey(ms, parameter, rowBounds, boundSql);
    return query(ms, parameter, rowBounds, resultHandler, key, boundSql);
}

@Override
public <E> List<E> query(MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, CacheKey key, BoundSql boundSql) {
    if (closed) {
        throw new RuntimeException("Executor was closed");
    }
    // 清理局部缓存，查询堆栈为0则清理。queryStack避免递归调用清理
    if (queryStack == 0 && ms.isFlushCacheRequired()) {
        clearLocalCache();
    }
    List<E> list;
    try {
        queryStack++;
        // 根据cacheKey从localCache中查询数据
        list = resultHandler == null ? (List<E>) localCache.getObject(key) : null;
        if (list == null) {
            //如果没有查询到就从数据库中查询
            list = queryFromDatabase(ms, parameter, rowBounds, resultHandler, key, boundSql);
        }
    } finally {
        queryStack--;
    }

    if (queryStack == 0) {
        if (configuration.getLocalCacheScope() == LocalCacheScope.STATEMENT) {
            clearLocalCache();
        }
    }

    return list;
}

private <E> List<E> queryFromDatabase(MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, CacheKey key, BoundSql boundSql) {
    List<E> list;
    localCache.putObject(key, ExecutionPlaceholder.EXECUTION_PLACEHOLDER);

    try {
        list = doQuery(ms, parameter, rowBounds, resultHandler, boundSql);
    } finally {
        localCache.removeObject(key);
    }

    localCache.putObject(key, list);
    return list;
}
```

- 先根据 CacheKey 在缓存中进行查询，如果缓存中没有就从数据库中查询；

当我们关闭 SqlSession 或者 提交事务 或者 回滚事务 或者调用 update、insert、 delete 方法时，都需要将缓存中的数据全部清空：

```java
@Override
public int update(MappedStatement mappedStatement, Object parameter) throws SQLException {
    if (closed) {
        throw new RuntimeException("Executor was closed.");
    }
    clearLocalCache();
    return doUpdate(mappedStatement, parameter);
}

@Override
public void commit(boolean require) throws SQLException {
    if (closed) {
        throw new RuntimeException("Executor was closed");
    }
    clearLocalCache();
    if (require) {
        transaction.commit();
    }
}

@Override
public void rollback(boolean require) throws SQLException {
    if (!closed) {
        try {
            clearLocalCache();
        } finally {
            if (require) {
                transaction.rollback();
            }
        }
    }
}

@Override
public void close(boolean forceRollback) throws SQLException {
    try {
        try {
            rollback(forceRollback);
        } finally {
            transaction.close();
        }
    } catch (SQLException e) {
        logger.warn("Unexpected exception on closing transaction.  Cause: " + e);
    } finally {
        transaction = null;
        closed = true;
    }

}
```

## 三、二级缓存
二级缓存是基于**命名空间的缓存**，它可以跨越会话，在多个会话中共享缓存。要使用二级缓存，需要在 Mybatis 的配置文件中配置相应的缓存实现类，并在 Mapper 接口上添加 CacheNamespace 注解。
![image.png](https://cdn.nlark.com/yuque/0/2024/png/27416797/1712496907560-1003a351-6303-4480-8c72-65b262082c9d.png#averageHue=%23f8f8f8&clientId=u282d7ea5-be8d-4&from=paste&height=314&id=u532a3ba5&originHeight=392&originWidth=764&originalType=binary&ratio=1.25&rotation=0&showTitle=false&size=39709&status=done&style=none&taskId=uef9b481a-e9a5-4c98-b2f8-72c2170c6c4&title=&width=611.2)

- 二级缓存是基于 namespace 的，所以一般情况下，Mybatis 的二级缓存是不适合多表查询情况的。举个例子：我们有两张表，student 和 class，我们现在 student 命名空间中进行了多表查询，关联到 student 表和 class 表，然后将结果缓存到二级缓存中去，然后我们再在 class 命名空间下更改 class 表的内容，这就会造成 student 命名空间下的缓存不一致。


## 四、二级缓存实现原理
在每个 MapperStatement 中，都封装了一个 Cache，这个 Cache 是我们配置的，可以是基于 FIFO 的 Cache，也可以是基于 LRU 的 Cache，在创建的 MapperStatement 的时候，就会根据二级缓存的配置信息，在 MapperBuilderAssistant 里创建 Cache，然后将 Cache 放入到 MapperStatement 中。

```java
public class MapperBuilderAssistant extends BaseBuilder {
    //当前命名空间的缓存
    private Cache currentCache;

    /**
     * 添加映射器语句
     */
    public MappedStatement addMappedStatement(String id,
                                              SqlSource sqlSource,
                                              SqlCommandType sqlCommandType,
                                              Class<?> parameterType,
                                              String resultMap,
                                              Class<?> resultType,
                                              boolean flushCache,
                                              boolean useCache,
                                              KeyGenerator keyGenerator,
                                              String keyProperty,
                                              LanguageDriver lang) {
        // 添加namespace前缀
        id = applyCurrentNameSpace(id, false);
        MappedStatement.Builder statementBuilder = new MappedStatement.Builder(configuration, id, sqlCommandType, sqlSource, resultType);

        //是否是select语句
        boolean isSelect = sqlCommandType == SqlCommandType.SELECT;

        statementBuilder.keyGenerator(keyGenerator);
        statementBuilder.keyProperty(keyProperty);

        // 结果映射，给 MappedStatement#resultMaps
        setStatementResultMap(resultMap, resultType, statementBuilder);
        setStatementCache(isSelect, flushCache, useCache, currentCache, statementBuilder);

        // 添加映射语句
        MappedStatement statement = statementBuilder.build();
        configuration.addMappedStatement(statement);
        return statement;
    }
}
```

然后，在执行查询时，就会将该同一个 Mapper 中查询到内容的值存放到该 MapperStatement 的 Cache 中：

```java
public class CachingExecutor implements Executor {

    private Logger logger = LoggerFactory.getLogger(CachingExecutor.class);
	// 通过装饰器模式，该Executor是SimpleExecutor类型
    private Executor delegate;

    private TransactionalCacheManager tcm = new TransactionalCacheManager();

    public CachingExecutor(Executor delegate) {
        this.delegate = delegate;
        delegate.setExecutorWrapper(this);
    }

    @Override
    public int update(MappedStatement ms, Object parameter) throws SQLException {
        return delegate.update(ms, parameter);
    }

    @Override
    public <E> List<E> query(MappedStatement mappedStatement, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, CacheKey cacheKey, BoundSql boundSql) {
        // 从对应的MapperStatement中获取二级cache
        Cache cache = mappedStatement.getCache();
        if (cache != null) {
            flushCacheIfRequired(mappedStatement);

            if (mappedStatement.isUseCache() && resultHandler == null) {
                //尝试获取二级缓存
                List<E> list = (List<E>) tcm.getObject(cache, cacheKey);
                if (list == null) {
                    // cache：缓存队列实现类，FIFO
                    // key：哈希值 [mappedStatementId + offset + limit + SQL + queryParams + environment]
                    // list：查询的数据
                    list = delegate.query(mappedStatement, parameter, rowBounds, resultHandler, cacheKey, boundSql);
                    // 存入二级缓存
                    tcm.putObject(cache, cacheKey, list);
                }
                // 打印调试日志，记录二级缓存获取数据
                if (logger.isDebugEnabled() && cache.getSize() > 0) {
                    logger.debug("二级缓存：{}", JSON.toJSONString(list));
                }
                return list;
            }
        }
        return delegate.query(mappedStatement, parameter, rowBounds, resultHandler, cacheKey, boundSql);
    }
}
```

- 通过装饰器模式，在 CachingExecutor 中封装了 SimpleExecutor 执行器，在里面封装了 TransactionalCacheManager 来增强 CachingExecutor 的功能。
- 将查询到数据放入到二级缓存中，每次查询时都先从二级缓存获取；

我们看看 TransactionalCacheManager  的实现

```java
public class TransactionalCacheManager {

    private Map<Cache, TransactionalCache> transactionalCaches = new HashMap<>();

    public void clear(Cache cache) {
        getTransactionCache(cache).clear();
    }

    /**
     * 得到某个TransactionalCache的值
     */
    public Object getObject(Cache cache, CacheKey key) {
        return getTransactionCache(cache).getObject(key);
    }

    public void putObject(Cache cache, CacheKey key, Object value) {
        getTransactionCache(cache).putObject(key, value);
    }

    /**
     * 提交时全部提交
     */
    public void commit() {
        for (TransactionalCache txCache : transactionalCaches.values()) {
            txCache.commit();
        }
    }

    /**
     * 回滚时全部回滚
     */
    public void rollback() {
        for (TransactionalCache txCache : transactionalCaches.values()) {
            txCache.rollback();
        }
    }

    private TransactionalCache getTransactionCache(Cache cache) {
        TransactionalCache txCache = transactionalCaches.get(cache);
        if (txCache == null) {
            txCache = new TransactionalCache(cache);
            transactionalCaches.put(cache, txCache);
        }
        return txCache;
    }
}
```

- 该管理器内部封装了一个 transactionalCaches Map集合，用来封装所有 MapperStatement 中的 Cache；
- 同时封装了一个 TransactionalCache，通过装饰器模式，来增强 Cache；

最后，我们再来看看 TransactionalCache 的实现

```java
public class TransactionalCache implements Cache {

    private Cache delegate;
    // commit 时要不要清缓存
    private boolean clearOnCommit;
    // commit 时要添加的元素
    private Map<Object, Object> entriesToAddOnCommit;
    private Set<Object> entriesMissedInCache;

    public TransactionalCache(Cache delegate) {
        this.delegate = delegate;
        this.clearOnCommit = false;
        this.entriesMissedInCache = new HashSet<>();
        this.entriesToAddOnCommit = new HashMap<>();
    }

    @Override
    public String getId() {
        return delegate.getId();
    }

    @Override
    public void putObject(Object key, Object value) {
        entriesToAddOnCommit.put(key, value);
    }

    @Override
    public Object getObject(Object key) {
        // key：CacheKey 拼装后的哈希码
        Object object = delegate.getObject(key);
        if (object == null) {
            entriesMissedInCache.add(key);
        }
        return clearOnCommit ? null : object;
    }

    @Override
    public Object removeObject(Object key) {
        return null;
    }

    @Override
    public void clear() {
        clearOnCommit = true;
        entriesToAddOnCommit.clear();
    }

    @Override
    public int getSize() {
        return delegate.getSize();
    }

    public void commit() {
        if (clearOnCommit) {
            delegate.clear();
        }
        flushPendingEntries();
        reset();
    }

    private void reset() {
        clearOnCommit = false;
        entriesToAddOnCommit.clear();
        entriesMissedInCache.clear();
    }

    /**
     * 刷新数据到 MappedStatement#Cache 中，也就是把数据填充到 Mapper XML 级别下。
     * flushPendingEntries 方法把事务缓存下的数据，填充到 FifoCache 中。
     */
    private void flushPendingEntries() {
        for (Map.Entry<Object, Object> entry : entriesToAddOnCommit.entrySet()) {
            delegate.putObject(entry.getKey(), entry.getValue());
        }
        for (Object entry : entriesMissedInCache) {
            if (!entriesToAddOnCommit.containsKey(entry)) {
                delegate.putObject(entry, null);
            }
        }
    }

    private void unlockMissedEntries() {
        for (Object entry : entriesMissedInCache) {
            delegate.putObject(entry, null);
        }
    }

    public void rollback() {
        unlockMissedEntries();
        reset();
    }

}
```

- 我们注意到，当向该类中的 entriesToAddOnCommit 添加缓存，当调用 commit方法时，会将  entriesToAddOnCommit  的内容写入到真正的缓存 delegate 中
