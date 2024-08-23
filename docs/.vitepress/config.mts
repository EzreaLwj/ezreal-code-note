import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Ezreal Code",
  description: "Java学习 Java笔记 Java教程",
  lastUpdated: true,
  markdown: {
    // 开启代码块的行号
    lineNumbers: true,
  },
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Examples', link: '/markdown-examples' },
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
      '/config/': [
        {
          text: 'Config',
          items: [
            { text: 'Index', link: '/config/' },
            { text: 'Three', link: '/config/three' },
            { text: 'Four', link: '/config/four' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/EzreaLwj' }
    ]
  }
})
