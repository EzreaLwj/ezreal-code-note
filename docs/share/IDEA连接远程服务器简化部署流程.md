# IDEA 连接远程服务器简化部署流程



## 背景

笔者每次上线部署应用，都要使用第三方的客户端连接工具，比如 Xshell，FinalShell，Terminus 等。基本的部署步骤是打包后的 Jar 包或者 dist 目录（前端）和 Dockerfile 文件通过第三方客户端连接工具上传到服务器上，及其繁琐！

基于这个原因，笔者今天探索通过 IDEA 连接远程服务器并上传文件，**减少繁琐的部署步骤**。



## 实现

笔者使用的 IDEA 是 2023.1.3 版本，版本较新，但兼容旧版本。



### 连接远程服务器

打开 IDEA 的 Settings 配置列表，选择 Tools 配置，选择 SSH Configuration ，填写我们的服务器信息

![配置SSH连接信息](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240129212400538.png)

- 填写我们的 主机IP、用户名、密码即可连接远程的服务器，最后点击 Apply 即可。



接着，点击 Tools -> Start SSH Session -> 选择我们刚刚配置好的服务器信息，就可以在终端上连接好我们刚刚配置的服务器。

![登录远程服务器](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/1706535066763.png)

- 连接完毕后，就可以对服务器进行操作了



### 配置 SFTP

配置 SFTP 的目的是让我们直接在 IDEA 中就可以上传文件，再也不用依赖其他客户端连接工具了。



首先，点击 Settings -> Build,Execution,Deployment -> Deployment 

![SFTP配置路径](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240129213626996.png)



接着点击左上角的 + 号，配置 SFTP 信息，最后点击 apply 即可。

![SFTP配置信息](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240129213731318.png)

- SSH configuration 可以选择我们刚刚配置好的 SSH 信息；
- Root Path（选填）：是登录到服务器中某个具体的文件路径；
- Web server URL（选填）：填写主机的 IP；



### 显示文件终端

点击 Tools -> Deployment -> Browser Remote Host，就可以显示我们服务器上的文件列表，通过拖拽本地文件即可实现文件上传；

![1706535853404](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/1706535853404.png)





## 应用部署

这里，我通过一个 VuePress 搭建的文档网站的部署进行演示，通过 IDEA 连接远程服务器进行部署，非常方便！



### 应用打包

通过 npm run docs build 命令进行打包，生成 dist 文件夹

![应用打包](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240129214701640.png)



将 dist 文件夹放到我准备好的 build 目录下，然后把整个 build 目录拖拽到我们服务器指定的位置上，打开服务器终端，进入到 build 的同级目录下

![登录服务器](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240129215024388.png)



然后执行脚本一键部署即可。
