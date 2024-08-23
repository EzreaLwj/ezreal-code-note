# VuePress 制作个人文档网站

> 作者：[Ezreal](https://github.com/EzreaLwj)
>
> 我的文档文章：https://ezreal-code-doc-0guti1ctfb6b5867-1312880100.tcloudbaseapp.com/

## 背景

[VuePress](https://vuepress.vuejs.org/zh/) 是一个基于 Vue 的静态网站生成器，它可以将我们编写好的 MarkDown 文件自动解析为 HTML 文件，它有以下几个特点：

- **简洁**：以 Markdown 为中心的项目结构，以最少的配置帮助你专注于写作。
- **Vue 驱动**：享受 Vue + webpack 的开发体验，可以在 Markdown 中使用 Vue 组件，又可以使用 Vue 来开发自定义主题。
- **高性能**：VuePress 会为每个页面预渲染生成静态的 HTML，同时，每个页面被加载的时候，将作为 SPA 运行。



下面带大家一起搭建基于 VuePress 的个人文档网站。



## 搭建过程



### 1. 搭建 VuePress 环境

根据[官网的快速上手][https://vuepress.vuejs.org/zh/guide/getting-started.html]进行操作，以下步骤与官网的操作有所区别：



**创建文件目录**

```shell
mkdir ezreal-code-doc && cd ezreal-code-doc
```

- 自己在某个文件夹下创建指定目录 `ezreal-code-doc` 即可；



**包管理器初始化**

```shell
yarn init
```

- 这里默认使用 yarn 作为包管理器；



**安装 VuePress 为本地依赖**

```shell
yarn add -D vuepress 
```



**在 package.json 中添加 scripts**

node 版本在 17 以下的执行脚本：

```json
{
  "scripts": {
    "docs:dev": "vuepress dev docs",
    "docs:build": "vuepress build docs"
  }
}
```

> 出现这个错误是因为 node.js V17版本中最近发布的OpenSSL3.0, 而OpenSSL3.0对允许算法和密钥大小增加了严格的限制，可能会对生态系统造成一些影响；
>
> 在node.js V17以前一些可以正常运行的的应用程序,但是在 V17 版本可能会抛出这个异常



node 版本在 17 及以上的执行脚本：

```json
{
  "scripts": {
    "docs:dev": "set NODE_OPTIONS=--openssl-legacy-provider & vuepress devd .",
    "docs:build": "set NODE_OPTIONS=--openssl-legacy-provider & vuepress build .",
    "serve": "export NODE_OPTIONS=--openssl-legacy-provider && vue-cli-service serve",
    "build": "export NODE_OPTIONS=--openssl-legacy-provider && vue-cli-service build"
  }
}
```



**启动服务器**

```shell
yarn docs:dev
```



我这里提供了项目模板，大家可以去下载使用：https://github.com/EzreaLwj/ezreal-code-doc/tree/template

### 2. 搭建目录结构

官网的[目录结构](https://vuepress.vuejs.org/zh/guide/directory-structure.html)是在把所有的文件都存储在 docs 目录下，但是下面的文件直接存储在项目的根目录下。



#### 2.1 创建配置目录

`.vuepress` 下的文件是整个文档网站的配置文件

![配置目录](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240122002939149.png)

- public：存储静态资源文件：网站图片，logo 等；
- templates：存储 HTML 模板文件；
- config.ts：是全局的配置文件，可以配置**侧边栏**，**导航栏**，**网站介绍**（head 标签和 meta 标签）；
- dist：是项目打包后的文件；



其中 config.ts 的文件基本结构如下：

```tsx
import sidebar from "./sidebar";
import navbar from "./navbar";

module.exports = {
    title: "是时候表演真正的技术了",
    base: '/', // 使用相对路径，读取相对路径下的静态文件
    head: [
        ['link', {rel: 'icon', href: '/logo.png'}],
        [
            "meta",
            {
                name: "keywords",
                content:
                    "Ezreal, 编程学习路线, 编程知识百科, Java, 编程导航, 前端, 开发, 编程分享, 项目, IT, 求职, 面经",
            },
        ],
    ],
    extraWatchFiles: [".vuepress/*.ts", ".vuepress/sidebars/*.ts"], // 热更新
    themeConfig: {
        nav: navbar,
        logo: '/logo.png',
        lastUpdated: 'Last Updated', // string | boolean
        sidebar: sidebar
    }
}

```



#### 2.2 创建文档目录

![文档目录](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240122003131907.png)



- 在项目的根目录下创建 `分享文章` 的目录；



每一个项目的目录都对应一个路由：

| 文件的相对路径                     | 页面路由地址                         |
| ---------------------------------- | ------------------------------------ |
| /README.md                         | /                                    |
| /分享文章/README.md                | /分享文章/                           |
| /分享文章/个人经验/README.md       | /分享文章/个人经验/                  |
| /分享文章/个人经验/2023年度总结.md | /分享文章/个人经验/2023年度总结.html |

- 每一个 README.md 文件**在页面路由地址上对应其文件夹的路径**；
- 除了 README.md 之外的文件的**文件相对路径在页面路由地址上是对应其转化后的 HTML 文件**；

- 如果有多层目录，则页面的路由地址也会有多层路径，如表格上的第四行；



### 3. 导航栏配置

在 config.ts 下，我们可以对导航栏进行配置，其对应的 key 为 nav：

```json
module.exports = {
    themeConfig: {
        nav: navbar,
        logo: '/logo.png',
        lastUpdated: 'Last Updated', // string | boolean
        sidebar: sidebar
    }
}

```

- 这里我们自己写了一个 navbar 的组件，接收的是一个数组类型；



navbar.ts：

```typescript
export default [
    {text: '分享文章', link: '/分享文章/'},
]
```

- text 是导航栏名称，link 是链接地址，其链接为` /分享文章/ `对应的文件为 `/分享文章/README.md`



效果如下：

![导航栏效果](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240122011529429.png)





### 4. 侧边栏配置

在 config.ts 下，我们可以对侧边栏进行配置，其对应的 key 为 sidebar

```json
module.exports = {
    themeConfig: {
        nav: navbar,
        logo: '/logo.png',
        lastUpdated: 'Last Updated', // string | boolean
        sidebar: sidebar
    }
}

```

- 这里我们自定义了一个 sidebar 组件，接收的是一个对象类型；



sidebar.ts

```typescript
import {SidebarConfig4Multiple} from "vuepress/config";
import shareSideBar from "./sidebars/shareSideBar";

// @ts-ignore
export default {
    "/分享文章/": shareSideBar,
    // 降级，默认根据文章标题渲染侧边栏
    "/": "auto",
} as SidebarConfig4Multiple;
```

- key 为 `/分享文章/`，值为 shareSideBar，表示当我们的 URL 路径为 `/分析文章/` 时，即渲染 `/分析文章/README.md` 文件时，会在侧边栏渲染我们在 `shareSideBar` 组件配置的信息；



shareSideBar.ts

```typescript
export default [
    "",
    {
        title: "个人经验",
        collapsable: true,
        children: [
            '/分享文章/个人经验/2023年度总结'
        ],
    },
    {
        title: "技术分享",
        collapsable: true,
        children: [
            '/分享文章/技术分享/基于MySQL与Redis扣减库存的方式.md',
            '/分享文章/技术分享/git常见命令以及常见问题.md',
            '/分享文章/技术分享/常见接口限流方法.md',
        ],
    },
    {
        title: "问题排查",
        collapsable: true,
        children: [
            '/分享文章/问题排查/记一次内存溢出问题解决.md',
        ],
    }
]
```

- shareSideBar 是一个数组类型，title 表示某个侧边栏的名称，children 下面就表示我们需要显示的文章；



效果如下：

![侧边栏效果](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240122012025322.png)



## 项目部署



### 腾讯云开发 CloudBase

我们基于[腾讯云开发 CloudBase](https://cloudbase.net/) 进行部署，云开发是一个云原生的 Serverless 云平台，支持静态网站，容器等多种托管能力，并提供简便的部署工具 [CloudBase Framework ](https://cloudbase.net/framework.html?site=vuepress) 进行一键部署。

![腾讯云开发](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240122013056615.png)

- 首先我们需要购买一套资源，个人版就合适；



在项目根目录安装 CloudBase CLI

```shell
npm install -D @cloudbase/cli
```



初始化应用

```shell
cloudbase init
```

- 这里需要选择我们刚刚购买的资源；



部署 VuePress 应用

```shell
cloudbase framework deploy
```

- 这里需要填写我们的**项目根目录的名称**，**打包命令**，**打包后的文件位置**（.vuepress/dist）；

- 在最后会显示一个可访问的 URL 路径，表示项目已经部署完成；

参考地址：https://github.com/Tencent/cloudbase-framework





