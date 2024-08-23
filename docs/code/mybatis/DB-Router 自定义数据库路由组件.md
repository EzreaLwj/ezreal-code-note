# 背景

为什么要分库分表？其实就是因为业务体量较大，数据增长较快，所有需要把用户数据拆分到不同的库表中，减轻数据库压力。

分库分表操作主要有**垂直拆分**和**水平拆分**：

- **垂直拆分**：按业务将表分类，分布到不同的数据库上，这样也就将数据的压力分摊到不同的库上面。最终一个数据库由分多表构成，每个表对应着不同的业务，也就是**专库专用**。
- **水平拆分**：如果垂直拆分后遇到单机瓶颈，可以使用水平拆分。相对于垂直拆分，水平拆分把同一个表拆到不同的数据库中。如：user_001、user_002

![](https://cdn.nlark.com/yuque/0/2024/png/27416797/1718615755505-d49b88d3-d761-4cb8-bb55-b70bdcd2e41d.png#averageHue=%23fbfbfa&clientId=u730944d0-c704-4&id=Pn56L&originHeight=791&originWidth=1030&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&taskId=u177bd846-f7b6-47ce-a9b5-5b275ade8d3&title=)

数据库路由设计涉及到的技术点：

- **AOP 切面拦截**：需要**使用数据库路由的方法做上标记**，便于处理分库分表逻辑；
- **数据源的切换操作**：既然有**分库那么就会涉及在多个数据源间进行链接切换**，以便把数据分配给不同的数据库；
- **数据库寻址操作**：一条数据分配到哪个数据库，哪张表，都需要进行索引计算。在方法调用的过程中最终通过 **ThreadLocal** 记录；
- 为了能让数据均匀的分配到不同的库表中去，还需要考虑如何进行数据散列的操作，不能分库分表后，让数据都集中在某个库的某个表，这样就失去了分库分表的意义；

## 技术调研

在 JDK 源码中，HashMap 和 ThreadLocal 用到了哈希索引、散列算法以及在数据膨胀时**拉链寻址**和**开放寻址**，所以我们要分析和借鉴的也会集中在这两个功能上

**ThreadLocal**

```java
// 利用开放寻址法来解决哈希冲突
for (Entry e = tab[i]; e != null; e = tab[i = nextIndex(i, len)]) {
    ThreadLocal<?> k = e.get();
    if (k == key) {
        e.value = value;
        return;
    }
    if (k == null) {
        replaceStaleEntry(key, value, i);
        return;
    }
}
```

- **数据结构**：散列表的数组结构；
- **散列算法**：斐波那契散列法；
- **寻址方式**：斐波那契散列法可以让数据更加分散，在发生数据碰撞时进行开放寻址，从碰撞节点向后寻址位置进行存放元素；

**HashMap**

```java
static final int hash(Object key) {
    int h;
    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}
```

- **数据结构**：哈希桶数组 + 链表 + 红黑树
- **散列算法**：扰动函数，哈希索引，可以让数据分布更加散列；
- **寻址方式**：通过**拉链寻址的方式解决数据碰撞**，数据存放时会进行索引地址，遇到碰撞产生数据链表，在一定容量超过 8 个元素进行扩容或者树化；

## 设计实现

### 实现流程

![](https://cdn.nlark.com/yuque/0/2024/png/27416797/1718615755456-65298c17-5b3c-485c-9542-a8dfbff5e308.png#averageHue=%23faf8f4&clientId=u730944d0-c704-4&id=ON78l&originHeight=178&originWidth=1302&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&taskId=u1f56459d-1dc1-4918-8734-e7eadf489bf&title=)

### 定义路由注解

```java
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.TYPE})
public @interface DBRouter {

    String key() default "";
}
```

- 该注解放置于需要被数据库路由的方法上；
- 它的使用方式是通过方法配置注解，就可以被我们指定的 AOP 切面进行拦截，拦截后进行相应的数据库路由计算和判断，并切换到相应的操作数据源上；

### 通过 AOP 获取路由键的值

```java
@Aspect
public class DbRouterPointCut {

    @Resource
    private DbRouterContextHolder dbRouterContextHolder;

    @Pointcut("@annotation(com.ezreal.middleware.db.router.annotation.DBRouter)")
    public void aopPoint() {
    }

    @Around("aopPoint() && @annotation(dbRouter)")
    public Object dbRouter(ProceedingJoinPoint pjp, DBRouter dbRouter) {
        MethodInvocationProceedingJoinPoint mpj = (MethodInvocationProceedingJoinPoint) pjp;
        try {
            String key = dbRouter.key();
            // 获取属性值
            String value = getAttrValue(mpj, key);
            // 存入ThreadLocal
            dbRouterContextHolder.setDbIdx(value);
            return mpj.proceed();
        } catch (Throwable e) {
            throw new RuntimeException(e);
        } finally {
            dbRouterContextHolder.clear();
        }
    }

    private String getAttrValue(MethodInvocationProceedingJoinPoint mpj, String key) throws IllegalAccessException {
        Object[] args = mpj.getArgs();
        String value = null;
        for (Object arg : args) {
            Field declaredField = null;
            try {
                declaredField = arg.getClass().getDeclaredField(key);
            } catch (NoSuchFieldException e) {
                continue;
            }
            declaredField.setAccessible(true);
            value = StrUtil.toString(declaredField.get(arg));
            break;
        }
        if (value == null) {
            throw new RuntimeException("the key is not fouud，key: " + key);
        }

        return value;
    }
}
```

- 通过 AOP 切面的方式并利用反射来获取 DBRouter 注解上的 key 值；
- 该方法目前不支持基本数据类型的获取，只支持获取实体类中某个字段的值；

### 生成库表索引

定义获取库表索引的接口

```java
public interface IDbRouterStrategy {
    /**
     * 生成库表索引
     * @param value 值
     */
    void createIdx(String value);

    int dbCounts();

    int tbCounts();
}
```

定义实现类

```java
public class DbRouterStrategy implements IDbRouterStrategy {

    private final Logger log = LoggerFactory.getLogger(DbRouterStrategy.class);

    @Autowired
    private DbRouterContextHolder dbRouterContextHolder;

    @Autowired
    private DBRouterConfigurationProperties dbRouterConfigurationProperties;

    @Override
    public void createIdx(String value) {

        int dbCounts = dbRouterConfigurationProperties.getDbCounts();
        int tbCounts = dbRouterConfigurationProperties.getTbCounts();

        // 根据HashMap的散列算法生成idx
        int size = dbCounts * tbCounts;
        int idx = (size - 1) & (value.hashCode() ^ (value.hashCode() >> 16));

        int dbIdx = idx / tbCounts + 1;
        int tbIdx = idx - tbCounts * (dbIdx - 1);
        log.info("生成的库表索引为, dbIdx:{}, tbIdx:{}", dbIdx, tbIdx);

        // 放入ThreadLocal中
        dbRouterContextHolder.setDbIdx(String.valueOf(dbIdx));
        dbRouterContextHolder.setTbIdx(String.valueOf(tbIdx));
    }

    @Override
    public int dbCounts() {
        return dbRouterConfigurationProperties.getTbCounts();
    }

    @Override
    public int tbCounts() {
        return dbRouterConfigurationProperties.getDbCounts();
    }
}
```

- **DbRouterContextHolder** 中封装了 **ThreadLocal**，通过 ThreadLocal 来实现跨域多个类传递线程的参数：tbIdx 和 dbIdx；
- 借鉴 HashMap 的**扰动函数**来生成库表的索引值；

### 通过索引更改数据源——分库查询

通过继承抽象类 AbstractRoutingDataSource，重写 determineCurrentLookupKey 方法，来实现动态的数据源切换。

```java
public class DynamicDataSource extends AbstractRoutingDataSource {

    @Resource
    private DbRouterContextHolder dbRouterContextHolder;

    @Override
    protected Object determineCurrentLookupKey() {
        return "db" + dbRouterContextHolder.getDbIdx();
    }
}
```

在抽象类 AbstractRoutingDataSource 中，会根据 determineCurrentLookupKey 获取指定的数据源，如果没有找到，则使用默认的数据源。

```java
protected DataSource determineTargetDataSource() {
    Assert.notNull(this.resolvedDataSources, "DataSource router not initialized");
    // 调用 determineCurrentLookupKey 方法去获取数据源的 key
    Object lookupKey = this.determineCurrentLookupKey();
    DataSource dataSource = (DataSource)this.resolvedDataSources.get(lookupKey);
    if (dataSource == null && (this.lenientFallback || lookupKey == null)) {
        dataSource = this.resolvedDefaultDataSource;
    }

    if (dataSource == null) {
        throw new IllegalStateException("Cannot determine target DataSource for lookup key [" + lookupKey + "]");
    } else {
        return dataSource;
    }
}
```

而我们自定义的 DynamicDataSource 类会在初始化时把我们定义好的数据源写入到 DataSourceMap 中

```java
@Bean
@Primary
public DataSource dynamicDataSource() {
    DynamicDataSource dynamicDataSource = new DynamicDataSource();

    // 设置动态数据源
    Set<String> keys = dynamicDataSourcesMap.keySet();
    Map<Object, Object> targetDataSources = new HashMap<>();
    for (String key : keys) {
        Map<String, Object> objectMap = dynamicDataSourcesMap.get(key);
        targetDataSources.put(key, new DriverManagerDataSource(objectMap.get("url").toString(), objectMap.get("username").toString(), objectMap.get("password").toString()));
    }

    dynamicDataSource.setTargetDataSources(targetDataSources);
    // 设置默认的数据源
    dynamicDataSource.setDefaultTargetDataSource(new DriverManagerDataSource(defaultDataSourceMap.get("url").toString(), defaultDataSourceMap.get("username").toString(), defaultDataSourceMap.get("password").toString()));
    return dynamicDataSource;
}
```

同时，要**重新设置事务管理器**

```java
@Bean
public TransactionTemplate transactionTemplate(DataSource dataSource) {
    DataSourceTransactionManager dataSourceTransactionManager = new DataSourceTransactionManager();
    dataSourceTransactionManager.setDataSource(dataSource);

    TransactionTemplate transactionTemplate = new TransactionTemplate();
    transactionTemplate.setTransactionManager(dataSourceTransactionManager);
    transactionTemplate.setPropagationBehaviorName("PROPAGATION_REQUIRED");
    return transactionTemplate;
}
```

### 通过 Mybatis 插件实现分表查询

基于 Mybatis 的插件注解 Intercepts，对 StatementHandler 类的 prepare 方法进行拦截，**修改其 sql 对应的表名**，从而达到分表的效果。

```java
@Intercepts({@Signature(type = StatementHandler.class, method = "prepare",args = {Connection.class, Integer.class})})
public class DynamicMybatisPlugin implements Interceptor {

    @Resource
    private DbRouterContextHolder dbRouterContextHolder;

    private final Pattern pattern = Pattern.compile("(from|into|update)[\\s]{1,}(\\w{1,})", Pattern.CASE_INSENSITIVE);

    @Override
    public Object intercept(Invocation invocation) throws Throwable {

        // 获取StatementHandler
        StatementHandler statementHandler = (StatementHandler) invocation.getTarget();
        MetaObject metaObject = MetaObject.forObject(statementHandler, SystemMetaObject.DEFAULT_OBJECT_FACTORY, SystemMetaObject.DEFAULT_OBJECT_WRAPPER_FACTORY, new DefaultReflectorFactory());
        MappedStatement mappedStatement = (MappedStatement) metaObject.getValue("delegate.mappedStatement");

        // 通过MappedStatement获取反射类
        String id = mappedStatement.getId();
        String className = id.substring(0, id.lastIndexOf("."));
        Class<?> aClass = Class.forName(className);
        DBRouterStrategy annotation = aClass.getAnnotation(DBRouterStrategy.class);

        // 如果没有分表处理
        if (annotation == null || !annotation.split()) {
            return invocation.proceed();
        }

        BoundSql boundSql = statementHandler.getBoundSql();
        String sql = boundSql.getSql();

        // 将sql替换表名
        Matcher matcher = pattern.matcher(sql);
        String tableName = null;
        if (matcher.find()) {
            tableName = matcher.group().trim();
        }
        String replaceSql = matcher.replaceAll(tableName + "_" + dbRouterContextHolder.getTbIdx());

        Field field = boundSql.getClass().getDeclaredField("sql");
        field.setAccessible(true);
        field.set(boundSql, replaceSql);
        field.setAccessible(false);

        return invocation.proceed();
    }
}
```
