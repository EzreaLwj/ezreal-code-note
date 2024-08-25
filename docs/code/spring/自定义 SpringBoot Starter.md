在 SpringBoot 中，创建一个自定义的 Starter 可以简化特定功能或者组件的配置过程，让其他项目能够轻松地重用这些功能。下面以自定义开放平台项目的 api sdk 为例。

### 引入依赖
```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-autoconfigure</artifactId>
</dependency>
```

- 引入最基本的依赖 spring-boot-autoconfigure

### 实现自动配置
在 starter 项目中，创建自动配置类。这个类需要使用 Configuration 注解标识，并根据条件使用 ConditionalOnBean 等条件化注解自动配置 bean。如果 starter 需要配置属性，可以通过定义一个属性配置类来实现，在属性配置类中使用 ConfigurationProperties 注解标识即可。

创建自动配置类：
```java
@Configuration
@EnableConfigurationProperties({ApiAutoConfigurationProperties.class})
public class ApiAutoConfiguration {

    @Bean
    public ApiClient apiClient() {
        return new ApiClient();
    }
}
```

定义属性配置类：
```java
@Data
@ConfigurationProperties(prefix = "api")
public class ApiAutoConfigurationProperties {

    private String gatewayHost;
}

```
### 创建配置类入口文件
在 starter 项目的 src/main/resources 下，创建 META-INF 目录，在里面创建一个 spring.factories 文件，通过 `org.springframework.boot.autoconfigure.EnableAutoConfiguration`引入我们的配置类即可。
```java
org.springframework.boot.autoconfigure.EnableAutoConfiguration
=com.api.configuration.ApiAutoConfiguration
```

这样就完成了，我们自定义 starter 的步骤。
