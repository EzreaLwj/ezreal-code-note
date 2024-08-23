# Mybatis 实现动态 SQL 原理

## 一、背景
动态 SQL 是指根据不同的条件生成不同的 SQL 语句，可以避免在编写 SQL 语句时出现重复的代码，提高代码的复用性和灵活性。

Mybatis 提供了一些标签来支持动态 SQL 的生成，常见的有 if 标签、choose 标签、when 标签、 otherwise 标签、foreach 标签。

## 二、动态 SQL 实现原理
在解析某个具体的 Statement 时，每一个标签都对应着一个 SqlNode，SqlNode 的接口定义为：

```java
/**
 * SQL节点
 * @author Ezreal
 * @Date 2024/3/13
 */
public interface SqlNode {

    boolean apply(DynamicContext context);
}
```

它的具体实现有 IfSqlNode，TextSqlNode，TrimSqlNode，StaticTextSqlNode，MixedSqlNode 等，分别对应 if 标签，文本内容，trim 标签，静态文本标签和混合 SqlNode，涉及到的设计模式是组合模式。

例如，我们看看 IfSqlNode 标签的内容：

```java
public class IfSqlNode implements SqlNode {

    private ExpressionEvaluator evaluator;

    private String test;

    private SqlNode contents;

    public IfSqlNode(SqlNode contents, String test) {
        this.test = test;
        this.contents = contents;
        this.evaluator = new ExpressionEvaluator();
    }

    @Override
    public boolean apply(DynamicContext context) {
        if (evaluator.evaluateBoolean(test, context.getBindings())) {
            contents.apply(context);
            return true;
        }
        return false;
    }
}
```

- 它通过聚合一个 SqlNode 类型，来实现向下寻找（即寻找 SqlNode 里面的标签，放入到该 SqlNode 中），通常这个聚合的 SqlNode 是 MixedSqlNode 类型。

我们再来看看 MixedSqlNode ：

```java
public class MixedSqlNode implements SqlNode {

    private List<SqlNode> contents;

    public MixedSqlNode(List<SqlNode> contents) {
        this.contents = contents;
    }

    @Override
    public boolean apply(DynamicContext context) {
        // 依次调用list里每个元素的apply
        contents.forEach(node -> node.apply(context));
        return true;
    }

}
```

- 它就是实现组合模式的关键，通过一个 List 集合来聚合当前标签下的所有标签。

定义完 SqlNode 后，我们需要在解析阶段将它们解析好，所以我们就需要使用 XMLLanguageDriver 类下的 createSqlSource 方法，其中 SqlSource 对象包含了当前标签下所有的 SqlNode，SqlSource 有 StaticSqlSource 、DynamicSqlSource 和 RawSqlSource 的实现。

```java
public class XMLLanguageDriver implements LanguageDriver {

    @Override
    public SqlSource createSqlSource(Configuration configuration, Element script, Class<?> parameterType) {
        XMLScriptBuilder builder = new XMLScriptBuilder(configuration, script, parameterType);
        return builder.parseScriptNode();
    }

    @Override
    public SqlSource createSqlSource(Configuration configuration, String script, Class<?> parameterType) {
        return new RawSqlSource(configuration, script, parameterType);
    }

    @Override
    public ParameterHandler createParameterHandler(MappedStatement mappedStatement, Object parameterObject, BoundSql boundSql) {
        return new DefaultParameterHandler(mappedStatement, parameterObject, boundSql);
    }
}
```

从上面代码可以看出，XMLLanguageDriver 通过内置了 XMLScriptBuilder 类来实现对标签的解析：

```java
public class XMLScriptBuilder extends BaseBuilder {

    private Element element;

    private boolean isDynamic;

    private Class<?> parameterType;

    private final Map<String, NodeHandler> nodeHanlderMap = new HashMap<>();

    public XMLScriptBuilder(Configuration configuration, Element element, Class<?> parameterType) {
        super(configuration);
        this.element = element;
        this.parameterType = parameterType;
        initNodeHandlerMap();
    }

    private void initNodeHandlerMap() {
        nodeHanlderMap.put("trim", new TrimHandler());
        nodeHanlderMap.put("if", new IfHandler());
    }

    public SqlSource parseScriptNode() {

        List<SqlNode> contents = parseDynamicTags(element);
        MixedSqlNode rootSqlNode = new MixedSqlNode(contents);
        SqlSource sqlSource = null;
        if (isDynamic) {
            sqlSource = new DynamicSqlSource(configuration, rootSqlNode);
        } else {
            sqlSource = new RawSqlSource(configuration, rootSqlNode, parameterType);
        }
        return sqlSource;
    }

    List<SqlNode> parseDynamicTags(Element element) {
        List<SqlNode> contents = new ArrayList<>();
        List<Node> children = element.content();
        for (Node child : children) {
            //如果是文本类型，就直接解析文本
            if (child.getNodeType() == Node.TEXT_NODE || child.getNodeType() == Node.CDATA_SECTION_NODE) {
                String data = child.getText();
                TextSqlNode textSqlNode = new TextSqlNode(data);
                if (textSqlNode.isDynamic()) {
                    contents.add(textSqlNode);
                    isDynamic = true;
                } else {
                    contents.add(new StaticTextSqlNode(data));
                }
            } else if (child.getNodeType() == Node.ELEMENT_NODE) {
                //如果是其他节点类型，就调用对应的处理器进行动态解析
                String name = child.getName();
                NodeHandler nodeHandler = nodeHanlderMap.get(name);
                if (nodeHandler == null) {
                    throw new RuntimeException("Unknown element <" + name + "> in SQL statement.");
                }
                nodeHandler.handleNode(element.element(child.getName()), contents);
                isDynamic = true;
            }
        }
        return contents;
    }
    
    private interface NodeHandler {
        void handleNode(Element nodeToHandle, List<SqlNode> targetContents);
    }

    private class TrimHandler implements NodeHandler {
        @Override
        public void handleNode(Element nodeToHandle, List<SqlNode> targetContents) {
            List<SqlNode> contents = parseDynamicTags(nodeToHandle);
            MixedSqlNode mixedSqlNode = new MixedSqlNode(contents);
            String prefix = nodeToHandle.attributeValue("prefix");
            String prefixOverrides = nodeToHandle.attributeValue("prefixOverrides");
            String suffix = nodeToHandle.attributeValue("suffix");
            String suffixOverrides = nodeToHandle.attributeValue("suffixOverrides");

            TrimSqlNode trim = new TrimSqlNode(configuration, mixedSqlNode, prefix, prefixOverrides, suffix, suffixOverrides);
            targetContents.add(trim);
        }
    }

    private class IfHandler implements NodeHandler {

        @Override
        public void handleNode(Element nodeToHandle, List<SqlNode> targetContents) {
            List<SqlNode> contents = parseDynamicTags(nodeToHandle);
            MixedSqlNode mixedSqlNode = new MixedSqlNode(contents);
            String test = nodeToHandle.attributeValue("test");
            IfSqlNode ifSqlNode = new IfSqlNode(mixedSqlNode, test);
            targetContents.add(ifSqlNode);
        }
    }
 }
```

- 从上面代码可以看出，该类是通过 parseDynamicTags 方法来解析标签的，如果只是文本内容的标签，则直接封装成对应的 SqlNode，否则就从 Map 集合中获取对应标签的 handler（策略模式）来进行处理；
- 这里的标签的 hanlder 就有 IfHandler 和 TrimHandler，在它们的 handleNode 方法中都回去调用 parseDynamicTags 方法，类似递归的逻辑；
- 所有解析后的标签，都会被封装到一个 SqlNode 的 List 集合中，然后再根据 Dynamic 参数将 List 类型的 SqlNode 封装到 SqlSource 中；

最终就得到该 Statement 的 SqlSource，将其封装到 StatementMapper 中即可。

在 SqlSession 调用时，会将 SqlSource 中所有的标签进行解析，最终形成一条 SQL 语句。

```java
public class DefaultSqlSession implements SqlSession {

    @Override
    public <T> T selectOne(String statement, Object parameter) {

        try {
            MappedStatement mappedStatement = configuration.getMappedStatement(statement);
            List<T> result = executor.query(mappedStatement, parameter, RowBounds.DEFAULT, Executor.NO_RESULT_HANDLER, mappedStatement.getSqlSource().getBoundSql(parameter));
            return result.get(0);
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }
}
```

- 在 query 方法的参数列表中，通过获取 MappedStatment 的 getSqlSource 方法获取 SqlSource，再调用 SqlSource 的 getBoundSql 方法获取对应的 BoundSql

比如说调用 DynamicSqlSource 的 getBoundSql 方法

```java
public class DynamicSqlSource implements SqlSource {

    private Configuration configuration;

    private SqlNode rootSqlNode;

    public DynamicSqlSource(Configuration configuration, SqlNode rootSqlNode) {
        this.configuration = configuration;
        this.rootSqlNode = rootSqlNode;
    }

    @Override
    public BoundSql getBoundSql(Object parameterObject) {

        //生成一个DynamicContext动态上下文
        DynamicContext context = new DynamicContext(configuration, parameterObject);
        //sqlNode.apply 将${}参数替换掉，不替换#{}这种参数
        rootSqlNode.apply(context);
        // 调用SqlSourceBuilder
        SqlSourceBuilder sqlSourceParser = new SqlSourceBuilder(configuration);
        Class<?> parameterType = parameterObject == null ? Object.class : parameterObject.getClass();
        // SqlSourceBuilder.parse 这里返回的是 StaticSqlSource，解析过程就把那些参数都替换成?了，也就是最基本的JDBC的SQL语句。
        SqlSource sqlSource = sqlSourceParser.parse(context.getSql(), parameterType, context.getBindings());
        //SqlSource.getBoundSql，非递归调用，而是调用 StaticSqlSource实现类
        BoundSql boundSql = sqlSource.getBoundSql(parameterObject);
        for (Map.Entry<String, Object> entry : context.getBindings().entrySet()) {
            boundSql.setAdditionalParameter(entry.getKey(), entry.getValue());
        }

        return boundSql;
    }
}
```

- 它调用 rootSqlNode 的 apply 方法，该方法会调用 List 集合中所有 SqlNode 类型的 apply 方法，然后将解析到的 Sql 语句封装到 DynamicContext 中；
- 接着通过 SqlSourceBuilder 来讲 Sql 语句中的 #{} 替换为 ?，形成最基本的 JDBC SQL 语句；

最终就形成一条可执行的 SQL 语句。


[16-解析含标签的动态SQL语句](https://www.yuque.com/ezrealwj/ny1ud5/wrdkdcc8qmfqsc06?view=doc_embed)
