在 Mybatis 的 mapper 文件中，可以使用#{param} 和 ${param} 来作为动态参数的替换。

#{} 类似于 jdbc 中的 PreparedStatement，对于传入的参数，在预处理阶段会使用 ？替换，可以有效避免 SQL 注入
```sql
select * from user where id = #{id}
```

- 这里的 #{id} 会被替换为 ?，并且 id 的值在执行时会被安全地设置为参数值。

使用 $ 传递参数时，Mybatis 会将其视为字面量，并在构建 SQL 语句时直接替换成参数的实际值。这意味着参数会直接拼接到 SQL 语句中。
```sql
select * from ${tableName}
```

- 由于 $ 导致的是直接替换，如果参数内容是用户输入，这可能导致** SQL 注入**的风险，因为恶意的输入可以被拼接成一部分 SQL 语句执行，

参考文章：
[https://www.cnblogs.com/feiyujun/articles/8746394.html](https://www.cnblogs.com/feiyujun/articles/8746394.html)

${} 的 SQL 注入问题：
Mybatis 中的 $ 符号会直接拼接参数，不会进行参数值的安全转义或预处理。如果不小心构造了恶意的参数值，就可能导致 SQL 注入攻击。

解决办法：

1. 使用 PreparedStatement 预编译语句，而不是 Statement，使用预编译的语句或参数化的语句，而不是通过字符串拼接构建 SQL 查询。
2. 用户输入校验，对用户的输入进行验证和过滤；
3. 最小权限原则：为数据库用户分配最小必要的权限，不使用过高权限的数据库账户连接数据库；
