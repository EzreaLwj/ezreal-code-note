Spring 中有许多优雅的设计，用到了很多的设计模式，大概有以下几种：

### 工厂模式
Spring 的 IOC 就是一个典型的工厂模式，Spring IOC 就像是一个工厂一样，当我们需要创建对象时，只需要从这个容器中获取即可，完全不用考虑这些对象是如何创建出来的。<br />[✅Spring IOC 实现原理](https://www.yuque.com/ezrealwj/nnv5da/zbm2d7g3qc6ada8r?view=doc_embed)

### 适配器模式
在 SpringMVC 中，HandlerAdapter 就是典型的适配器模式。<br />对于 DispatchServlet 来说，HanlderAdapter 是核心的业务逻辑处理流程，DispatchServlet 只负责调用	HanlderAdapter 的 hanlde 方法即可，至于当前的 Http 请求是如何处理，则交给具体的 HandlerAdapter 的实现方负责。换句话说，HandlerAdapter 只是定义了和 DispatchServlet 交互的标准，帮助不同的实现适配了 DispatchServlet 而已。<br />参考文章：[https://juejin.cn/post/7215397054260330533](https://juejin.cn/post/7215397054260330533)<br />[✅Spring MVC 实现原理](https://www.yuque.com/ezrealwj/nnv5da/hqm326li4vba3ytl?view=doc_embed)

### 代理模式
代理模式的目的就是增强被代理的类，SpringAOP 就是代理类的典型代表。<br />[✅Spring AOP 实现原理](https://www.yuque.com/ezrealwj/nnv5da/httmgksabk84g8t9?view=doc_embed)
### 观察者模式
Spring 中的事件机制就是观察者模式的实现。<br />[✅Spring 中监听器实现原理](https://www.yuque.com/ezrealwj/nnv5da/fg7sibz8c85vdxgo?view=doc_embed)

### 单例模式
单例模式是 Spring 一个核心功能，Spring 中的 Bean 默认都是单例的，这样可以尽最大限度保证对象的复用和线程安全。<br />![image.png](https://cdn.nlark.com/yuque/0/2024/png/27416797/1718613466872-4eabe656-444b-4543-af27-cc5cb4ba87be.png#averageHue=%23f0f0f0&clientId=u595a6b55-dc06-4&from=paste&height=290&id=u92155e59&originHeight=362&originWidth=954&originalType=binary&ratio=1.25&rotation=0&showTitle=false&size=61507&status=done&style=none&taskId=u1261bc69-18a2-4473-9194-0f5e5d59f81&title=&width=763.2)


### 模板方法模式
在 Spring 的事务管理中，TransactionTemplate 这个类用到了模板方法模式，它把事务的操作按照 3 个固定的步骤来写：

- 执行业务逻辑；
- 如果异常则回滚事务；
- 否则提交事务；
```java
@Override
@Nullable
public <T> T execute(TransactionCallback<T> action) throws TransactionException {
	Assert.state(this.transactionManager != null, "No PlatformTransactionManager set");

	if (this.transactionManager instanceof CallbackPreferringPlatformTransactionManager) {
		return ((CallbackPreferringPlatformTransactionManager) this.transactionManager).execute(this, action);
	}
	else {
		TransactionStatus status = this.transactionManager.getTransaction(this);
		T result;
		try {
			// 执行业务逻辑
			result = action.doInTransaction(status);
		}
		catch (RuntimeException | Error ex) {
			// Transactional code threw application exception -> rollback
			// 回滚事务
			rollbackOnException(status, ex);
			throw ex;
		}
		catch (Throwable ex) {
			// Transactional code threw unexpected exception -> rollback
			rollbackOnException(status, ex);
			throw new UndeclaredThrowableException(ex, "TransactionCallback threw undeclared checked exception");
		}
		// 提交事务
		this.transactionManager.commit(status);
		return result;
	}
}
```

### 责任链模式
对于 SpringMVC 来说，它会通过一系列的拦截器来处理请求执行前，执行后，以及结束的 response，核心的类是 handlerExecutionChain，它封装了一系列的过滤器和 HandlerAdapter。
```java
boolean applyPreHandle(HttpServletRequest request, HttpServletResponse response) throws Exception {
	HandlerInterceptor[] interceptors = getInterceptors();
	if (!ObjectUtils.isEmpty(interceptors)) {
		for (int i = 0; i < interceptors.length; i++) {
			HandlerInterceptor interceptor = interceptors[i];
			if (!interceptor.preHandle(request, response, this.handler)) {
				triggerAfterCompletion(request, response, null);
				return false;
			}
			this.interceptorIndex = i;
		}
	}
	return true;
}
```
