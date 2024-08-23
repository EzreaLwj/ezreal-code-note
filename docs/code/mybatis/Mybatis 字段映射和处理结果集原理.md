# Mybatis 字段映射和处理结果集原理

## 一、字段映射方式
Mybatis 通过 ResultSet 对象来获取 SQL 查询返回的结果集，然后将结果集中的每行记录映射到 Java 对象中，在字段映射过程中，Mybatis 提供以下几种方式：

1. **使用列名映射**：Mybatis 默认使用列名查询结果集中与 Java 对象中的属性；
2. **使用别名映射**：如果 SQL 语句中使用了别名，则 Mybatis 会优先使用列别名来映射 Java 对象属性名；
3. **使用 ResultMap 映射**：ResultMap 是 Mybatis 用来映射查询结果集和 Java 对象属性关系。可以在映射文件中定义 ResultMap，指定 Java 对象和列之间的映射关系。
4. **自定义 TypeHandler 映射**：通过 TypeHandler 接口来自定义字段映射规则，TypeHandler 可以将查询结果集中的列类型转换为 Java 对象属性类型，并将 Java 对象属性类型转换为 SQL 类型。

## 二、字段映射原理
Mybatis 实现字段映射的代码主要在 **DefaultResultSetHandler** 类中，该类是处理 Mybatis 查询结果集处理的核心类，负责将 JDBC ResultSet 对象转换为 Java 对象，并进行字段映射。

Mybatis 实现字段映射的原理可以简单描述为以下几个步骤：

1. Mybatis 通过 JDBC API 向数据库发送 SQL 查询语句，获取结果集 ResultSet；
2. 查询结果集中每一行数据 ResultSet 封装成 ResultSetWrapper，Mybatis 处理 ResultSetWrapper 中的数据（ResultSetWrapper 的作用是包装结果集，处理结果集映射的字段）；
3. 根据返回对象类型通过反射创建出对象，然后将其封装成 MetaObject，便于反射调用；
4. 然后分别根据字段和 ResultMap 进行反射赋值；
5. 最后将所有的结果封装到一个 List 集合中，返回给业务代码；

```java
public class DefaultResultSetHandler implements ResultSetHandler {

    @SuppressWarnings("unchecked")
    @Override
    public List<Object> handleResultSets(Statement statement) throws SQLException {

        final List<Object> multipleResults = new ArrayList<>();
        int resultSetCount = 0;
		//获取ResultSet封装成ResultSetWrapper
        ResultSetWrapper rsw = new ResultSetWrapper(statement.getResultSet(), configuration);

        // 获取语句的返回值配置
        List<ResultMap> resultMaps = mappedStatement.getResultMaps();
        while (rsw != null && resultMaps.size() > resultSetCount) {
            // 遍历所有的resultMap
            ResultMap resultMap = resultMaps.get(resultSetCount);
            handleResultSet(rsw, resultMap, multipleResults, null);
            rsw = getNextResultSet(statement);
            resultSetCount++;
        }
        return multipleResults.size() == 1 ? (List<Object>) multipleResults.get(0) : multipleResults;

    }

    private void handleResultSet(ResultSetWrapper rsw, ResultMap resultMap, List<Object> multipleResults, ResultMapping resultMapping) throws SQLException {
        if (resultHandler == null) {
            // 1.新创建结果处理器
            DefaultResultHandler defaultResultHandler = new DefaultResultHandler(objectFactory);
            // 2.封装数据
            handleRowValuesForSimpleResultMap(rsw, resultMap, defaultResultHandler, rowBounds, null);
            // 3.保存结果
            multipleResults.add(defaultResultHandler.getResultList());

        }
    }

    private void handleRowValuesForSimpleResultMap(ResultSetWrapper rsw, ResultMap resultMap, DefaultResultHandler resultHandler, RowBounds rowBounds, ResultMapping parentMapping) throws SQLException {
        DefaultResultContext resultContext = new DefaultResultContext();
        while (resultContext.getResultCount() < rowBounds.getLimit() && rsw.getResultSet().next()) {
			//遍历每一行数据，数据就是ResultSetWrapper
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
            // Map映射：根据映射类型赋值到字段
            applyPropertyMappings(rsw, resultMap, metaObject, null);
        }
        return resultObject;
    }
}
```
