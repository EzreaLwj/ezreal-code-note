import {defineConfig} from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Ezreal Code",
  description: "Java学习 Java笔记 Java教程",
  lastUpdated: true,
  head: [
    [
      'meta',
      {'name': 'referrer', 'content': 'no-referrer'}
    ],
  ],
  markdown: {
    // 开启代码块的行号
    lineNumbers: true,
  },
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '主页', link: '/' },
      {text: '源码解析', link: '/code'},
      { text: '分享文章', link: '/share' },
      { text: '作者', link: '/author' },
    ],
    outline: [1,5],
    sidebar: {
      // 当用户位于 `guide` 目录时，会显示此侧边栏
      '/share/': [
        {
          text: '分享文章',
          items: [
            { "text": "git常见命令以及常见问题", "link": "/share/git常见命令以及常见问题.md" },
            { "text": "guava-retry源码分析", "link": "/share/guava-retry源码分析.md" },
            { "text": "IDEA连接远程服务器简化部署流程", "link": "/share/IDEA连接远程服务器简化部署流程.md" },
            { "text": "MySQL索引分析", "link": "/share/MySQL索引分析.md" },
            { "text": "MySQL插入10万条数据", "link": "/share/MySQL插入10万条数据.md" },
            { "text": "PageHelper实现分页原理", "link": "/share/PageHelper实现分页原理.md" },
            { "text": "POI内存溢出问题以及EasyExcel优化原理", "link": "/share/POI 内存溢出问题以及EasyExcel优化原理.md" },
            { "text": "Spring循环依赖与三级缓存", "link": "/share/Spring循环依赖与三级缓存.md" },
            { "text": "Synchronized锁升级过程", "link": "/share/Synchronized锁升级过程.md" },
            { "text": "Transaction事务注解实现原理", "link": "/share/Transaction事务注解实现原理.md" },
            { "text": "TreeMap实现原理", "link": "/share/TreeMap实现原理.md" },
            { "text": "基于MySQL与Redis扣减库存的方式", "link": "/share/基于MySQL与Redis扣减库存的方式.md" },
            { "text": "基于Vuepress制作个人文档网站", "link": "/share/基于Vuepress制作个人文档网站.md" },
            { "text": "常见接口限流方法", "link": "/share/常见接口限流方法.md" },
            { "text": "秒级查询秒级的跨域！一次慢SQL优化历险！", "link": "/share/秒级查询秒级的跨域——一次慢SQL优化历险.md" },
            { "text": "记一次内存溢出问题解决", "link": "/share/记一次内存溢出问题解决.md" }
          ]

        }
      ],

      // 当用户位于 `config` 目录时，会显示此侧边栏
      '/code/mybatis/': [
        {
          text: 'Mybatis',
          items: [
            {"text": "DB-Router 自定义数据库路由组件", "link": "/code/mybatis/DB-Router 自定义数据库路由组件.md"},
            {"text": "Mybatis 中 # 和 $ 的区别是什么", "link": "/code/mybatis/Mybatis中预处理符号实现原理.md"},
            {"text": "Mybatis 字段映射和处理结果集原理", "link": "/code/mybatis/Mybatis 字段映射和处理结果集原理.md"},
            {"text": "Mybatis 实现动态 SQL 原理", "link": "/code/mybatis/Mybatis 实现动态 SQL 原理.md"},
            {"text": "Mybatis 工作原理", "link": "/code/mybatis/Mybatis 工作原理.md"},
            {"text": "Mybatis 延迟加载原理", "link": "/code/mybatis/Mybatis 延迟加载原理.md"},
            {"text": "Mybatis 插件运行原理", "link": "/code/mybatis/Mybatis 插件运行原理.md"},
            {"text": "Mybatis 缓存机制", "link": "/code/mybatis/Mybatis 缓存机制.md"},
            {"text": "Mybatis 连接池机制", "link": "/code/mybatis/Mybatis 连接池机制.md"},
            {"text": "PageHelper 实现原理", "link": "/code/mybatis/PageHelper 实现原理.md"},
            {"text": "什么是 ORM，有哪些常用框架", "link": "/code/mybatis/什么是ORM有哪些常用框架.md"}
          ]

        }
      ],

      '/code/rocketmq/': [
        {"text": "01-RocketMQ基本概念", "link": "/code/rocketmq/01-RocketMQ基本概念.md"},
        {"text": "02-RocketMQ特性", "link": "/code/rocketmq/02-RocketMQ特性.md"},
        {"text": "03-Message内部结构", "link": "/code/rocketmq/03-Message内部结构.md"},
        {"text": "04-Producer启动流程分析", "link": "/code/rocketmq/04-Producer启动流程分析.md"},
        {"text": "05-Producer发送Message流程", "link": "/code/rocketmq/05-Producer发送Message流程.md"},
        {"text": "06-MessageQueue的选择逻辑", "link": "/code/rocketmq/06-MessageQueue的选择逻辑.md"},
        {"text": "07-Broker启动流程分析", "link": "/code/rocketmq/07-Broker启动流程分析.md"},
        {"text": "08-Broker心跳机制解析", "link": "/code/rocketmq/08-Broker心跳机制解析.md"},
        {"text": "09-Broker接收存储Message", "link": "/code/rocketmq/09-Broker接收存储Message.md"},
        {"text": "10-Message落盘过程", "link": "/code/rocketmq/10-Message落盘过程.md"},
        {"text": "11-NameServer解析", "link": "/code/rocketmq/11-NameServer解析.md"},
        {"text": "12-ConsumerQueue的初始化", "link": "/code/rocketmq/12-ConsumerQueue的初始化.md"},
        {"text": "13-Consumer启动流程分析", "link": "/code/rocketmq/13-Consumer启动流程分析.md"},
        {"text": "14-Message消费之旅", "link": "/code/rocketmq/14-Message消费之旅.md"},
        {"text": "16-资源的负载均衡Rebalance流程解析", "link": "/code/rocketmq/16-资源的负载均衡Rebalance流程解析.md"}
      ],

      '/code/spring/': [
        {"text": "Spring IOC 实现原理", "link": "/code/spring/Spring IOC 实现原理.md"},
        {"text": "Spring AOP 实现原理", "link": "/code/spring/Spring AOP 实现原理.md"},
        {"text": "AOP 切面的执行顺序", "link": "/code/spring/AOP 切面的执行顺序.md"},
        {"text": "JDK 动态代理和 Cglib 动态代理的区别", "link": "/code/spring/JDK 动态代理和 Cglib 动态代理的区别.md"},
        {"text": "Spring MVC 实现原理", "link": "/code/spring/Spring MVC 实现原理.md"},
        {"text": "Spring 中的扩展点", "link": "/code/spring/Spring 中的扩展点.md"},
        {"text": "Spring 中监听器实现原理", "link": "/code/spring/Spring 中监听器实现原理.md"},
        {"text": "Spring 中设计模式的应用", "link": "/code/spring/Spring 中设计模式的应用.md"},
        {"text": "Spring 事务传播机制", "link": "/code/spring/Spring 事务传播机制.md"},
        {"text": "Spring 事务实现原理", "link": "/code/spring/Spring 事务实现原理.md"},
        {"text": "Spring 循环依赖与三级缓存", "link": "/code/spring/Spring 循环依赖与三级缓存.md"},
        {"text": "SpringBoot 启动流程", "link": "/code/spring/SpringBoot 启动流程.md"},
        {"text": "SpringBoot 和 Spring 的区别是什么", "link": "/code/spring/SpringBoot 和 Spring 的区别是什么.md"},
        {
          "text": "SpringBoot 如何配置多个数据源以及切换数据源",
          "link": "/code/spring/SpringBoot 如何配置多个数据源以及切换数据源.md"
        },
        {"text": "SpringBoot 自动装配原理", "link": "/code/spring/SpringBoot 自动装配原理.md"},
        {"text": "Transactional 事务注解实现原理", "link": "/code/spring/Transactional 事务注解实现原理.md"},
        {"text": "自定义 SpringBoot Starter", "link": "/code/spring/自定义 SpringBoot Starter.md"}
      ],
      '/code/dubbo/': [
        {"text": "01-Dubbo的SPI机制", "link": "/code/dubbo/01-Dubbo的SPI机制.md"},
        {"text": "02-Dubbo整体架构", "link": "/code/dubbo/02-Dubbo整体架构.md"},
        {"text": "03-Dubbo实现原理：服务注册", "link": "/code/dubbo/03-Dubbo实现原理：服务注册.md"}
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/EzreaLwj' }
    ]
  }
})
