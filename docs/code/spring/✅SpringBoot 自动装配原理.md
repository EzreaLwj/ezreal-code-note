## 一、背景
SpringBoot 会根据类路径下的 jar 包、类，为 jar 包里的类自动配置，这样可以极大的减少配置的数量。简单点说就是它会根据定义在 ClassPath 下的类，自定的给你生成一些 Bean，并加载到 Spring 的 Context 中。

在 Spring 容器启动的时候，由于使用了 EnableAutoConfiguration 注解，该注解 Import 的 EnableAutoConfigurationImportSelector 会去扫描 classpath 下的所有 spring.factories，然后进行 bean 的自动化配置。

## 二、源码分析

1. 在 SpringBoot 的启动类上有一个注解 `@SpringBootApplication`，这个注解是对三个注解进行封装
   1. @SpringBootConfiguration
   2. @ComponentScan
   3. **@EnableAutoConfiguration **
2. 其中 `@EnableAutoConfiguration` 是 SpringBoot 自动装配的核心注解，这里面有两个注解
   1.  @Import{AutoConfigurationImportSelector.class}
   2. @AutoConfigurationPackage，作用是设置扫描包的路径，后续要针对当前的包进行扫描
3. `@ Import{AutoConfigurationImportSelector.class}` 是自动装配的核心注解，它将会加载该项目和该项目引入的 Jar 包类路径下的 `META-INF/spring.factories` 中所配置的类，然后通过 Conditional 等条件注解来判断要不要把配置类装配的 Spring 容器中
4. 最后通过 `SpringFactoriesLoader.loadFactoryNames()` 读取 ClassPath 下面的 `META-INF/spring.factories` 文件
