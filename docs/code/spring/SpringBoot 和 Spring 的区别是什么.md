## 一、背景
Spring 是一个非常强大的企业级 Java 开发框架，提供了一系列模块来支持不同的应用需求，如**依赖注入**，**面向切面编程**（AOP）、**事务管理**、**Web 应用程序开发**。而 SpringBoot 的出现，主要是起到了简化 Spring 应用程序的**配置**、**开发**和**部署**，特别是用于构建微服务和快速开发的应用程序。<br /> 
## 二、SpringBoot 的提升
相比于 Spring，SpringBoot 主要在这几个方面来提升了我们使用 Spring 的效率，降低开发成本：
### 2.1 自动装配
SpringBoot 通过 AutoConfiguration 来减少工作人员的配置作用。我们可以通过依赖一个 Starter 就把一坨东西全部依赖进来，使开发人员可以更专注于业务逻辑而不是配置；
### 2.2 内嵌 Web 服务器
SpringBoot 内置了常见的 Web 服务器（Tomcat、Jetty），这意味着可以轻松创建可运行的独立应用程序，而无需外部 Web 服务器；
### ☀️2.3 约定大于配置
SpringBoot 中有很多约定大于配置的思想体现。通过一种约定的方式，来降低开发人员的配置工作。如它**默认读取 spring.factories 来加载 starter**、**读取 application.properties 或 application.yml 文件来进行属性的配置**等。
