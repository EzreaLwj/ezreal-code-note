# Mybaits 设计流程
仓库地址：[https://github.com/EzreaLwj/ezreal-mybatis](https://github.com/EzreaLwj/ezreal-mybatis)
## 一、配置读取部分

以 XmlConfigBuilder 作为入口，配置的读取分为两部分，一部分是环境信息的读取，包括数据源和事务管理器，另一部分是 Mapper 映射器的解析

![image1](https://cdn.nlark.com/yuque/0/2024/png/27416797/1712466108586-69d7b8cb-c18e-49c2-a3b0-92c3415d7e47.png#averageHue=%23fcfbfa&clientId=ufddff671-a576-4&id=yqlam&originHeight=748&originWidth=1784&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&taskId=uf637528a-3077-4827-bec8-db9ff4122fe&title=)

### 1.1 Mapper映射器的解析

调用 XmlConfigBuilder 的 mapperElement 方法为解析 Mapper 配置的入口，它会**依次调用** ：

- XmlMapperBuilder 解析 Mapper 文件，创建 ProxyFactory 代理对象工厂，并循环解析 Mapper 中的 SQL 语句，然后将 MapperProxyFactory 放入到 Mapper 映射器中；
- XmlStatmentBuilder 解析 Mapper 文件中的 SQL 语句： 
   - **参数解析**，调用语言驱动器的 createSqlSource 方法创建 SqlSource 对象，里面包含了 ParameterMapping 参数对象，同时每个 ParameterMapping 中含有一个 TypeHandler 类型处理器，用于设置调用参数和返回值；
   - **结果集解析**，调用 MapperBuilderAssistant 构建器助手，根据 ResultType 封装 ResultMap，最后聚合 **Sql 字符串对象**、**ResultMap** 和 **SqlSource** 创建 MappedStatement 语句映射器对象；
- 最后将 MappedStatment 和 ProxyFacotory 对象写入到 Configuration 对象中

### 1.2 环境信息读取

主要是读取数据源配置和事务管理器的配置：

- 数据源配置包括用户名，密码，驱动类路径，数据库 URL；
- 事务管理器的配置主要是读取类型，比如说是 JDBC 事务管理器；

### 1.3 Mybatis 初始化流程
![](https://cdn.nlark.com/yuque/0/2024/webp/27416797/1723607399748-d550708c-2aa2-466b-96df-533fe53f55a4.webp#averageHue=%230b0b0b&clientId=u7bce94ac-a494-4&from=paste&id=u5674d2f6&originHeight=624&originWidth=1500&originalType=url&ratio=1.25&rotation=0&showTitle=false&status=done&style=none&taskId=ua7c78448-e90d-41d5-9cdc-3e310141d41&title=)

### 1.4 Mybatis 查询流程
![](https://cdn.nlark.com/yuque/0/2024/webp/27416797/1723607622006-b934a5be-a56b-4e2e-992f-aeb78ed4f059.webp#averageHue=%230f0f0f&clientId=u7bce94ac-a494-4&from=paste&id=ubdb1eb27&originHeight=484&originWidth=1500&originalType=url&ratio=1.25&rotation=0&showTitle=false&status=done&style=none&taskId=uc9e5c2ad-f067-4ad7-a9a3-2126a289eb1&title=)

### 1.5 Mybatis 拦截器初始化流程
![](https://cdn.nlark.com/yuque/0/2024/webp/27416797/1723607646347-37ccbd5f-9e3c-4442-8b6a-91ef24bd515d.webp#averageHue=%230b0b0b&clientId=u7bce94ac-a494-4&from=paste&id=u72aa7f50&originHeight=634&originWidth=962&originalType=url&ratio=1.25&rotation=0&showTitle=false&status=done&style=none&taskId=u77884d6b-b883-472b-8ee4-f56cd1cd9e6&title=)

## 二、SqlSession 进行数据库操作

在我们从 XmlConfigBuilder 中解析完毕，获取了 Configuration 配置后，我们就可以创建 SqlSession 来进行数据库操作了。Configuration 中包含了 **MappedStatment 语句映射Map集合**，**Mapper代理注册器**，**类型处理器注册器**和**数据库环境**等。

### 2.1 整体流程

![](https://cdn.nlark.com/yuque/0/2024/png/27416797/1712466108266-6938c8f0-6eda-49f4-bfa3-8ba15d701cc4.png#averageHue=%23151413&clientId=ufddff671-a576-4&id=QLzrz&originHeight=4732&originWidth=8636&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&taskId=u2376c7cc-bb26-4a45-b6ac-710666d3402&title=)

- **SqlSessionFactoryBuilder** 是数据库操作的入口，里面创建了一个 **XmlConfigBuilder**，用于创建 Configuration 对象，然后调用 build 方法，创建 **DefaultSqlSessionFactory** 对象，并将 **Configuration** 放入到该对象中，用于 **DefaultSqlSession** 对象。
- DefaultSqlSessionFactory 的 openSession 方法是创建 DefaultSqlSession 的唯一方法，它会创建**事务管理器**和**执行器**，然后将这两者方法入到 DefaultSqlSession，至此，DefaultSqlSession 就有了操作数据库的能力；
- DefaultSqlSession 提供了 getMapper 方法来获取代理对象，该方法有两个参数，一个是接口的 Class 对象，一个是 SqlSession 对象，从而获取到的代理对象聚合了 SqlSession，我们的代理对象就有了操作数据库的能力。从代理对象中，我们根据**类路径 + 方法名**，在 MapperStatement 映射器中找到对应的 MapperStatement 语句，然后调用 executor 来执行数据库操作：首先通过事务管理器获取 Connection，然后通过 PrepareStatmentHandler 来组装 PrepareStatment，包括创建 Statement（Prepare），调用 ParameterHandler 的 TypeHandler 给 PrepareStatment 拼装参数（Parameterize），调用数据库操作（query），最后通过 ResultSetHandler 来拼装结果集。
- Executor 是位于 DefaultSqlSession 中的，而事务管理是位于 Executor 中的，数据源是位于 Transaction 中的，Connection 是位于数据源中的，这样一层层包裹，就完成了 SQL 的最终调用。
- 可见，一次 SqlSession的操作或者或在一个 SqlSession 的存活期间，里面就包含了一次完整的数据库操作。

### 2.2 参数解析流程

关于 ParameterHandler 的操作，这里简要说一下：

#### 2.2.1 参数解析

核心处理分为三块：**参数处理**、**参数设置**、**参数使用**；

- 以定义 TpyeHandler 类型处理器接口，实现不同的处理策略，包括：Long，String，Integer 等；
- 类型策略处理器实现完成后，需要注册到处理器注册机中，后续其他模块参数的设置还是使用都是从 Configuration 中获取到 TypeHandlerRegistry 进行使用。
- 那么有了这样的策略处理器以后，在进行操作解析 SQL 的时候，就可以**按照不同的类型**把**对应的策略处理器**设置到 BoundSql#**parameterMappings** 参数里，后续使用也是从这里进行获取。

#### 2.2.2 参数使用

ParameterHandler 的 setParameters 方法，会将传入的 parameterObject 通过 TypeHandler 设置到  PrepareStatment 中去。

```java
public class DefaultParameterHandler implements ParameterHandler {

    private Logger logger = LoggerFactory.getLogger(DefaultParameterHandler.class);

    private final TypeHandlerRegistry typeHandlerRegistry;

    private final MappedStatement mappedStatement;

    private final Object parameterObject;

    private BoundSql boundSql;

    private Configuration configuration;

    public DefaultParameterHandler(MappedStatement mappedStatement, Object parameterObject, BoundSql boundSql) {
        this.mappedStatement = mappedStatement;
        this.parameterObject = parameterObject;
        this.boundSql = boundSql;
        this.typeHandlerRegistry = mappedStatement.getConfiguration().getTypeHandlerRegistry();;
        this.configuration = mappedStatement.getConfiguration();
    }

    @Override
    public Object getParameterObject() {
        return parameterObject;
    }

    @Override
    public void setParameters(PreparedStatement ps) throws SQLException {
        List<ParameterMapping> parameterMappings = boundSql.getParameterMappings();
        if (parameterMappings != null) {
            for (int i = 0; i < parameterMappings.size(); i++) {
                ParameterMapping parameterMapping = parameterMappings.get(i);
                String propertyName = parameterMapping.getProperty();
                Object value;
                if (typeHandlerRegistry.hasTypeHandler(parameterObject.getClass())) {
                    value = parameterObject;
                } else {
                    MetaObject metaObject = configuration.newMetaObject(parameterObject);
                    value = metaObject.getValue(propertyName);
                }

                JdbcType jdbcType = parameterMapping.getJdbcType();
                // 设置参数
                logger.info("根据每个ParameterMapping中的TypeHandler设置对应的参数信息 value：{}", JSON.toJSONString(value));
                TypeHandler typeHandler = parameterMapping.getTypeHandler();
                typeHandler.setParameter(ps, i + 1, value, jdbcType);
            }
        }
    }
}
```

### 2.2 结果集处理器解析

从 `DefaultSqlSession` 调用 Executor 语句执行器，一直到 `PreparedStatementHandler` 预处理后的语句，最后就是 `DefaultResultSetHandler` 结果信息的封装。

前面章节对此处的封装处理，并没有解耦的操作，只是简单的 JDBC 使用通过查询结果，反射处理返回信息就结束了。如果是使用这样的一个简单的 if···else 面向过程方式进行开发，那么后续所需要满足 Mybatis 的全部封装对象功能，就会变得特别吃力，一个方法块也会越来越大。

所以，这一部分的内容处理是需要被解耦的，分为：**对象的实例化**、**结果信息的封装**、**策略模式的处理**、**写入上下文返回**等操作，只有这样的解耦操作，才能更加方便的扩展流程不同节点的各类需求。

![](https://cdn.nlark.com/yuque/0/2024/png/27416797/1712466108880-91dadadf-77cf-4366-afef-59770ac95a8d.png#averageHue=%231f2125&clientId=ufddff671-a576-4&id=ixnE8&originHeight=275&originWidth=1279&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&taskId=ue216882b-feb8-44e0-a5ff-f524d99805a&title=)

- 这一套处理流程包括：**创建结果处理器**，**封装数据**，**保存结果**；

#### 2.2.1 结果集处理器

```java
public class DefaultResultHandler implements ResultHandler {

    private List<Object> list;

    @SuppressWarnings("unchecked")
    public DefaultResultHandler(ObjectFactory objectFactory) {
        list = objectFactory.create(List.class);
    }

    @Override
    public void handleResult(ResultContext context) {
        list.add(context.getResultObject());
    }

    public List<Object> getResultList() {
        return list;
    }
}
```

- 这里封装了一个非常简单的结果集对象，默认情况下都会写入到这个对象的 list 集合中。

#### 2.2.2 对象创建

根据 resultType 创建对应的返回对象：

```java
/**
 * 创建结果
 */
private Object createResultObject(ResultSetWrapper rsw, ResultMap resultMap, List<Class<?>> constructorArgTypes, List<Object> constructorArgs, String columnPrefix) throws SQLException {
    final Class<?> resultType = resultMap.getType();
    final MetaClass metaType = MetaClass.forClass(resultType);
    if (resultType.isInterface() || metaType.hasDefaultConstructor()) {
        // 普通的Bean对象类型
        return objectFactory.create(resultType);
    }
    throw new RuntimeException("Do not know how to create an instance of " + resultType);
}
```

- 对于这样的普通对象，只需要使用反射工具类就可以实例化对象了，不过这个时候属性信息还没有填充。_其实和我们使用的 clazz.newInstance(); 也是一样的效果_

#### 2.2.3 属性填充

对象实例化完成后，就是根据 ResultSet 获取出对应的值填充到对象中去，但这里需要注意，这个结果的获取来自于 `TypeHandler#getResult` 接口新增的方法，由不同的类型处理器实现，通过这样的策略模式设计方式就可以巧妙的避免 if···else 的判断处理。

```java
private void handleRowValuesForSimpleResultMap(ResultSetWrapper rsw, ResultMap resultMap, DefaultResultHandler resultHandler, RowBounds rowBounds, ResultMapping parentMapping) throws SQLException {
    DefaultResultContext resultContext = new DefaultResultContext();
    while (resultContext.getResultCount() < rowBounds.getLimit() && rsw.getResultSet().next()) {
        Object rowValue = getRowValue(rsw, resultMap);
        callResultHandler(resultHandler, resultContext, rowValue);
    }
}

/**
 * 获取一行的值
 */
private Object getRowValue(ResultSetWrapper rsw, ResultMap resultMap) throws SQLException {
    // 根据返回类型，实例化对象
    Object resultObject = createResultObject(rsw, resultMap, null);
    if (resultObject != null && !typeHandlerRegistry.hasTypeHandler(resultMap.getType())) {
        // 获取该对象的反射信息
        final MetaObject metaObject = configuration.newMetaObject(resultObject);
        // 对该对象进行赋值操作
        applyAutomaticMappings(rsw, resultMap, metaObject, null);
    }
    return resultObject;
}

private boolean applyAutomaticMappings(ResultSetWrapper rsw, ResultMap resultMap, MetaObject metaObject, String columnPrefix) throws SQLException{
    // 获取数据库的列名
    final List<String> unmappedColumnNames = rsw.getUnMappedColumnNames(resultMap, columnPrefix);
    boolean foundValues = false;
    for (String columnName : unmappedColumnNames) {
        String propertyName = columnName;
        if (columnPrefix != null && !columnPrefix.isEmpty()) {
            // When columnPrefix is specified,ignore columns without the prefix.
            if (columnName.toUpperCase(Locale.ENGLISH).startsWith(columnPrefix)) {
                propertyName = columnName.substring(columnPrefix.length());
            } else {
                continue;
            }
        }
        final String property = metaObject.findProperty(propertyName, false);
        if (property != null && metaObject.hasSetter(property)) {
            final Class<?> propertyType = metaObject.getSetterType(property);
            if (typeHandlerRegistry.hasTypeHandler(propertyType)) {
                final TypeHandler<?> typeHandler = rsw.getTypeHandler(propertyType, columnName);
                // 使用 TypeHandler 取得结果
                final Object value = typeHandler.getResult(rsw.getResultSet(), columnName);
                if (value != null) {
                    foundValues = true;
                }
                if (value != null || !propertyType.isPrimitive()) {
                    // 通过反射工具类设置属性值
                    metaObject.setValue(property, value);
                }
            }
        }
    }
    return foundValues;
}
```

- 调用 getRowValue 方法，先创建返回值对象，然后调用 applyAutomaticMappings 方法，向该对象中将 ResultSet 中返回的值写入到返回值对象中。

## 三、Mybatis Plugin 插件功能实现

Mybatis 插件功能的核心是：通过代理模式，将 Mybatis 中的核心组件：StatementHandler、ParameterHandler、ResultSetHandler 等生成代理对象，用我们自定义的拦截器对这些对象里面某个具体的方法进行增强。

自定义拦截器注解：

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface Intercepts {

    Signature[] value();
}
```

- 该拦截器注解中又包含了方法签名注解 Signature

方法签名注解：

```java
public @interface Signature {

    /**
     * 被拦截类
     */
    Class<?> type();

    /**
     * 被拦截类的方法
     */
    String method();

    /**
     * 被拦截类的方法的参数
     */
    Class<?>[] args();
}
```

- 方法签名注解中有三个参数：拦截类的类型 type、具体拦截的方法 method 和拦截方法的参数 args，**这三个参数可以唯一确定某个类中的某个方法**。比如说 StatementHandler 带有 Connection 参数的 prepare 方法。

解析拦截器注解，生成代理对象

```java
public class Plugin implements InvocationHandler {

    private Object target;

    private Interceptor interceptor;

    private Map<Class<?>, Set<Method>> signatureMap;

    public Plugin(Object target, Interceptor interceptor, Map<Class<?>, Set<Method>> signatureMap) {
        this.target = target;
        this.interceptor = interceptor;
        this.signatureMap = signatureMap;
    }

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {

        Set<Method> methods = signatureMap.get(method.getDeclaringClass());
        if (methods != null && methods.contains(method)) {
            return interceptor.intercept(new Invocation(target, method, args));
        }
        return method.invoke(target, args);
    }

    /**
     * 用代理把自定义插件行为包裹到目标方法中，也就是 Plugin.invoke 的过滤调用
     *
     * @param target      目标对象
     * @param interceptor 拦截器
     * @return
     */
    public static Object wrap(Object target, Interceptor interceptor) {

        // 取得签名Map
        Map<Class<?>, Set<Method>> signatureMap = getSignatureMap(interceptor);
        // 取得要改变行为的类(ParameterHandler|ResultSetHandler|StatementHandler|Executor)，目前只添加了 StatementHandler
        Class<?> type = target.getClass();
        // 取得接口
        Class<?>[] interfaces = getAllInterfaces(type, signatureMap);
        //创建代理(StatementHandler)
        if (interfaces.length > 0) {
            // Proxy.newProxyInstance(ClassLoader loader, Class<?>[] interfaces, InvocationHandler h)
            return Proxy.newProxyInstance(
                    type.getClassLoader(),
                    interfaces,
                    new Plugin(target, interceptor, signatureMap));
        }
        return target;

    }

    // 解析Intercepts注解
    private static Map<Class<?>, Set<Method>> getSignatureMap(Interceptor interceptor) {
        // 取 Intercepts 注解
        Intercepts interceptsAnnotation = interceptor.getClass().getAnnotation(Intercepts.class);
        // 必须有Intercepts注解，没有报错
        if (interceptsAnnotation == null) {
            throw new RuntimeException("No @Intercepts annotation was found in interceptor " + interceptor.getClass().getName());
        }
        // value是数组型，Signature的数组
        Signature[] sigs = interceptsAnnotation.value();
        // 每个class类有多个可能有多个Method需要被拦截
        Map<Class<?>, Set<Method>> signatureMap = new HashMap<>();
        for (Signature sig : sigs) {
            Set<Method> methods = signatureMap.computeIfAbsent(sig.type(), k -> new HashSet<>());

            Method method = null;
            try {
                // 例如获取到方法；StatementHandler.prepare(Connection connection)、StatementHandler.parameterize(Statement statement)...
                method = sig.type().getMethod(sig.method(), sig.args());
                methods.add(method);
            } catch (NoSuchMethodException e) {
                throw new RuntimeException("Could not find method on " + sig.type() + " named " + sig.method() + ". Cause: " + e, e);
            }
        }
        return signatureMap;
    }

    /**
     * 取得接口
     *
     * @param type         类型
     * @param signatureMap 方法签名
     * @return
     */
    private static Class<?>[] getAllInterfaces(Class<?> type, Map<Class<?>, Set<Method>> signatureMap) {
        Set<Class<?>> interfaces = new HashSet<>();
        while (type != null) {
            for (Class<?> c : type.getInterfaces()) {
                // 拦截 ParameterHandler|ResultSetHandler|StatementHandler|Executor
                if (signatureMap.containsKey(c)) {
                    interfaces.add(c);
                }
            }
            type = type.getSuperclass();
        }
        return interfaces.toArray(new Class<?>[interfaces.size()]);
    }
}
```

- 解析 Intercepts 注解，获取里面的 Signature 注解的信息，封装到一个 SignatureMap 中，key 是具体的类对象，value 就是方法对象。
- 同时 Plugin 类还实现了 InvocationHandler 接口，该接口用于生成代理对象，在 invoke 方法中，通过当前类的信息从 SignatureMap 中获取所有的拦截器，执行拦截器的 Intercept 方法即可。

解析自定义的拦截器，组装成 InterceptorChain

```java
public class XmlConfigBuilder extends BaseBuilder {

    /**
     * Mybatis 允许你在某一点切入映射语句执行的调度
     * <plugins>
     *     <plugin interceptor="cn.bugstack.mybatis.test.plugin.TestPlugin">
     *         <property name="test00" value="100"/>
     *         <property name="test01" value="100"/>
     *     </plugin>
     * </plugins>
     */
    private void pluginElement(Element parent) throws Exception {
        if (parent == null) {
            return;
        }
        List<Element> elements = parent.elements();
        for (Element element : elements) {
            String interceptor = element.attributeValue("interceptor");

            //参数配置
            Properties properties = new Properties();
            List<Element> propertyElementList = element.elements("property");
            for (Element property : propertyElementList) {
                properties.setProperty(property.attributeValue("name"), property.attributeValue("value"));
            }

            //获取插件实现类并实例化
            Interceptor interceptorInstance = (Interceptor) resolveClass(interceptor).newInstance();
            interceptorInstance.setProperties(properties);
            configuration.addInterceptor(interceptorInstance);
        }
    }
}
```

- 通过解析 XML 文件，封装 Interceptor 对象，将该对象放入到 InterceptorChain  中

我们看看 InterceptorChain 对象

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

## 四、Mybatis 一级缓存实现

在 Executor 的抽象实现类 BaseExecutor 中存在 PerpetualCache 类，该类其实是封装了一个 Map 对象：

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

## 五、Mybatis 二级缓存实现

在每个 MapperStatement 中，都封装了一个 Cache，这个 Cache 是我们配置的，可以是基于 FIFO 的 Cache，也可以是基于 LRU 的 Cache，在创建的 MapperStatement 的时候，就会根据二级缓存的配置信息，在 MapperBuilderAssistant 里创建 Cache，然后将 Cache 放入到 MapperStatement 中。

```java
public class MapperBuilderAssistant extends BaseBuilder {

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
