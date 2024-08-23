[✅SpringBoot的启动流程是怎么样的？](https://www.yuque.com/hollis666/uzgwh1/fadkbgd4fyv8816p?view=doc_embed)

1. **初始化各种属性，加载成对象 **
- 读取环境属性（`Environment`）
- 系统配置（`spring.factories`）
- 参数`（Arguments，application.properties）`
2. 创建 **spring** 容器对象 `**ApplicationContext**`，加载各种配置
3. 在容器创建前，通过监听器机制，应对不同阶段加载数据，更新数据的需求
4. 容器初始化过程中追加各种功能，例如统计时间、输出日志等；

代码分析
```java
@SpringBootApplication
@EnableTransactionManagement
@EnableAspectJAutoProxy
public class Application {

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}

public static ConfigurableApplicationContext run(Class<?>[] primarySources, String[] args) {
	return (new SpringApplication(primarySources)).run(args);
}

```

在这个 run 方法中，共执行了两部分的代码：**构造器方法 **和 **run 方法**
### 构造器方法
```java
public SpringApplication(ResourceLoader resourceLoader, Class<?>... primarySources) {
	
	// 赋值资源加载器
	this.resourceLoader = resourceLoader;
	Assert.notNull(primarySources, "PrimarySources must not be null");
	// 将传入的primarySources 转化为到set集合中
	this.primarySources = new LinkedHashSet<>(Arrays.asList(primarySources));
	// 确定web应用类型
	this.webApplicationType = WebApplicationType.deduceFromClasspath();

	//使用 SpringFactoriesLoader查找并加载 classpath下 META-INF/spring.factories
	// 文件中所有可用的 ApplicationContextInitializer
	setInitializers((Collection) getSpringFactoriesInstances(ApplicationContextInitializer.class));
	//使用 SpringFactoriesLoader查找并加载 classpath下 META-INF/spring.factories
	//文件中的所有可用的 ApplicationListener
	setListeners((Collection) getSpringFactoriesInstances(ApplicationListener.class));
	// 推断并设置 main方法的定义类，即启动类，SpringApplication注解标记的类
	this.mainApplicationClass = deduceMainApplicationClass();
}
```

1. 给 resourceLoader 赋值
2. 确定 Web 的应用类型，有三种类型：Reactive、Servlet、None，默认使用 Servlet 类型
3. 加载 Spring.factories 中的 ApplicationContextInitializer
> ApplicationContextInitializer 是 Spring Framework 提供的一个扩展点，用于在 Spring 应用程序上下文加载时进行初始化和定制。它允许开发人员在 Spring 容器准备就绪之前对应用程序上下文进行自定义初始化。

4. 加载 Spring.factories 中的 ApplicationListener
> ApplicationListener 是 Spring Framework 提供的一个接口，用于监听 Spring 应用上下文中的事件并采取相应的行动。当 Spring 容器中触发与该监听器相关的事件时，监听器会被调用以执行特定的逻辑。

### run 方法
![](https://cdn.nlark.com/yuque/0/2023/png/5378072/1700292941424-49b97eaa-c0b7-43cc-b933-5a93a612ce7b.png?x-oss-process=image%2Fwatermark%2Ctype_d3F5LW1pY3JvaGVp%2Csize_42%2Ctext_SmF2YSA4IEd1IEM%3D%2Ccolor_FFFFFF%2Cshadow_50%2Ct_80%2Cg_se%2Cx_10%2Cy_10#averageHue=%23f4f4f4&from=url&id=HZ3z0&originHeight=414&originWidth=1481&originalType=binary&ratio=1.25&rotation=0&showTitle=false&status=done&style=none&title=)
```java
public ConfigurableApplicationContext run(String... args) {
	StopWatch stopWatch = new StopWatch();
	stopWatch.start();
	ConfigurableApplicationContext context = null;
	configureHeadlessProperty();
	
	// 通过 SpringFactoriesLoader 加载 META-INF/spring.factories 文件
	// 获取并创建 SpringApplicationRunListener 对象
	SpringApplicationRunListeners listeners = getRunListeners(args);
	//然后由 SpringApplicationRunListener 来发出 starting 消息
	listeners.starting();
	try {
		// 创建参数，并配置当前 SpringBoot 应用将要使用的 Environment
		ApplicationArguments applicationArguments = new DefaultApplicationArguments(args);
		// 完成之后，依然由 SpringApplicationRunListener 来发出 environmentPrepared 消息
		ConfigurableEnvironment environment = prepareEnvironment(listeners, applicationArguments);
		
		configureIgnoreBeanInfo(environment);
		Banner printedBanner = printBanner(environment);
		// 创建 ApplicationContext
		context = createApplicationContext();
		// 初始化 ApplicationContext，并设置 Environment，加载相关配置等
		prepareContext(context, environment, listeners, applicationArguments, printedBanner);

		// refresh ApplicationContext，完成IoC容器可用的最后一步
		refreshContext(context);
		afterRefresh(context, applicationArguments);
		stopWatch.stop();
		if (this.logStartupInfo) {
			new StartupInfoLogger(this.mainApplicationClass).logStarted(getApplicationLog(), stopWatch);
		}
		// 由 SpringApplicationRunListener 来发出 started 消息
		listeners.started(context);
		// 完成最终的程序的启动，这步是调用SpringBoot启动后要执行的代码
		callRunners(context, applicationArguments);
	}
	catch (Throwable ex) {
		handleRunFailure(context, ex, listeners);
		throw new IllegalStateException(ex);
	}

	try {
		// 由 SpringApplicationRunListener 来发出 running 消息，告知程序已运行起来了
		listeners.running(context);
	}
	catch (Throwable ex) {
		handleRunFailure(context, ex, null);
		throw new IllegalStateException(ex);
	}
	return context;
}

```

1. 运行 stopWatch
2. 记录应用启动时间
3. 创建引导上下文（Context 环境）**createBootStrapContext()**
4. 让当前应用进入 headless 模式
5. 获取所有 RunnerLinstener（运行监听器），为了方便所有 Linstener 做事件感知
6. 遍历所有 RunnerLinstener，调用 start 方法（监听机制）
7. 保存命令行参数，ApplicationArguments
8. 准备环境，**prepareEnvironment()** ❗
   1. 返回或创建基础环境信息对象，StandardServletEnvironment
   2. 配置环境信息对象，读取所有配置源的配置属性值
   3. 绑定环境信息
   4. 监听器调用 Linstener.environment.prepare()，通知所有监听器当前环境准备完成
9. 创建 IOC 容器（**createApplicationContext**）❗
   1. 根据项目类型（Servlet）创建容器
10. 准备 ApplicationContext IOC 容器的基本信息，**prepareContext() **❗
   1. 保存环境信息
   2. IOC 容器的后置处理流程
   3. 应用初始化器，applyInitializers
   4. 遍历所有 ApplicationContextInitializer，调用 initialize 方法
   5. 遍历所有 lintener 调用 contextPrepared
   6. 所有监听器调用 contextLoaded 
11. 刷新 IOC 容器，refreshContext ❗
12. 容器刷新完后调用 afterRefresh 方法
13. 所有监听器调用 Listener.started(context) 方法，调用所有监听器 started
14. 调用所有 runners，callRunners
   1. 获取容器中的 ApplicationRunner
   2. 获取容器中的 CommandLineRunner 
   3. 合并所有 runner 并且按照 order 排序
   4. 遍历所有 runner 调用 run 方法
15. 如果以上有异常，调用 linstener fail 方法
16. 调用所有监听器的 running 方法，Linstener.running(context) ，通知所有监听器 running
17. running 如果有问题，就会调用 fail 方法


1. 开始计时；
2. 创建所有监听器；
3. 创建并初始化 ApplicationContext，其中会调用 refresh 方法，刷新容器，场景 Bean 工厂
4. 发送 started 消息，停止计时；

**其他版本**

1. 通过 SpringFactoriesLoader 加载 `META-INF/spring.factories` 文件，获取并创建 `SpringApplicationRunListener` 对象
> SpringApplicationRunListener 是 Spring Boot 的一个事件监听器接口，用于监听 Spring Boot 应用程序的启动过程。它允许你在 Spring Boot 应用程序启动的不同阶段插入自定义的逻辑

2. 然后由 `SpringApplicationRunListener` 来发出 starting 消息
3. 创建参数，并配置当前 SpringBoot 应用将要使用的 Environment
4. 完成之后，依然由 SpringApplicationRunListener 来发出 environmentPrepared 消息
5. **创建 ApplicationContext **❗createApplicationContext
6. 初始化 ApplicationContext，并设置 Environment，加载相关配置等 prepareContext
   1. 保存环境信息
   2. IOC容器的后置处理流程
   3. 遍历所有  ApplicationContextInitializer，调用 initialize 方法，对 IOC 容器进行扩展操作
7. 由 SpringApplicationRunListener 来发出 contextPrepared 消息，告知SpringBoot 应用使用的 ApplicationContext 已准备OK 
8. 将各种 beans 装载入 ApplicationContext，继续由 SpringApplicationRunListener 来发出 contextLoaded 消息，告知 SpringBoot 应用使用的 ApplicationContext 已装填 OK
9. refresh ApplicationContext，完成IoC容器可用的最后一步 —— 实例化容器的所有配置 **❗**
10. 由 SpringApplicationRunListener 来发出 started 消息
11. 完成最终的程序的启动
12. 由 SpringApplicationRunListener 来发出 running 消息，告知程序已运行起来了

<br />简单来说就是配置 Environment，创建 ApplicationContext，配置 Bean 工厂（IOC容器）


![image.png](https://cdn.nlark.com/yuque/0/2023/png/27416797/1696654132164-2304caaf-b209-4225-babd-81a846778bbb.png#averageHue=%230a0905&clientId=u1bf7efb8-f5bb-4&from=paste&id=zMcd1&originHeight=527&originWidth=1240&originalType=url&ratio=1.25&rotation=0&showTitle=false&size=160859&status=done&style=none&taskId=u9d7477ae-a539-4429-a535-8d7bc3e55aa&title=)

额外注意下，ApplicationContext 的 refresh 方法，它是 SpringBoot 中初始化 Bean 容器的关键
```java
@Override
public void refresh() throws BeansException, IllegalStateException {
	synchronized (this.startupShutdownMonitor) {
		// Prepare this context for refreshing.
		prepareRefresh();

		// Tell the subclass to refresh the internal bean factory.
		ConfigurableListableBeanFactory beanFactory = obtainFreshBeanFactory();

		// Prepare the bean factory for use in this context.
		prepareBeanFactory(beanFactory);

		try {
			// Allows post-processing of the bean factory in context subclasses.
			postProcessBeanFactory(beanFactory);

			// Invoke factory processors registered as beans in the context.
			invokeBeanFactoryPostProcessors(beanFactory);

			// Register bean processors that intercept bean creation.
			registerBeanPostProcessors(beanFactory);

			// Initialize message source for this context.
			initMessageSource();

			// Initialize event multicaster for this context.
			initApplicationEventMulticaster();

			// Initialize other special beans in specific context subclasses.
			onRefresh();

			// Check for listener beans and register them.
			registerListeners();

			// Instantiate all remaining (non-lazy-init) singletons.
			// 初始化单例 Bean 这个方法最关键
			finishBeanFactoryInitialization(beanFactory);

			// Last step: publish corresponding event.
			finishRefresh();
		}

		catch (BeansException ex) {
			if (logger.isWarnEnabled()) {
				logger.warn("Exception encountered during context initialization - " +
						"cancelling refresh attempt: " + ex);
			}

			// Destroy already created singletons to avoid dangling resources.
			destroyBeans();

			// Reset 'active' flag.
			cancelRefresh(ex);

			// Propagate exception to caller.
			throw ex;
		}

		finally {
			// Reset common introspection caches in Spring's core, since we
			// might not ever need metadata for singleton beans anymore...
			resetCommonCaches();
		}
	}
}


/**
 * Finish the initialization of this context's bean factory,
 * initializing all remaining singleton beans.
 */
protected void finishBeanFactoryInitialization(ConfigurableListableBeanFactory beanFactory) {
	// Initialize conversion service for this context.
	if (beanFactory.containsBean(CONVERSION_SERVICE_BEAN_NAME) &&
			beanFactory.isTypeMatch(CONVERSION_SERVICE_BEAN_NAME, ConversionService.class)) {
		beanFactory.setConversionService(
				beanFactory.getBean(CONVERSION_SERVICE_BEAN_NAME, ConversionService.class));
	}

	// Register a default embedded value resolver if no BeanFactoryPostProcessor
	// (such as a PropertySourcesPlaceholderConfigurer bean) registered any before:
	// at this point, primarily for resolution in annotation attribute values.
	if (!beanFactory.hasEmbeddedValueResolver()) {
		beanFactory.addEmbeddedValueResolver(strVal -> getEnvironment().resolvePlaceholders(strVal));
	}

	// Initialize LoadTimeWeaverAware beans early to allow for registering their transformers early.
	String[] weaverAwareNames = beanFactory.getBeanNamesForType(LoadTimeWeaverAware.class, false, false);
	for (String weaverAwareName : weaverAwareNames) {
		getBean(weaverAwareName);
	}

	// Stop using the temporary ClassLoader for type matching.
	beanFactory.setTempClassLoader(null);

	// Allow for caching all bean definition metadata, not expecting further changes.
	beanFactory.freezeConfiguration();

	// Instantiate all remaining (non-lazy-init) singletons.
	// 提前实例化
	beanFactory.preInstantiateSingletons();
}

```
