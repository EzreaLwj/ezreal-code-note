## 一、什么是 AOP 
AOP 是面向切面编程的简称，可以动态在某个类的方法前、后、前后进行增强，添加额外的执行逻辑。

**连接点**：所有可以被增强的方法；<br />**切入点（PointCut）**：实际上被增强的方法；<br />**通知（Advice）**：增强部分的代码逻辑；<br />**切面**：切入点和通知的组合，通常表现成为一个类；<br />**织入**：切入点和通知动态组合的过程；<br />![](https://cdn.nlark.com/yuque/0/2023/png/27416797/1677298186713-ffaf07c2-5054-45f2-b0f3-aec224442a0f.png?x-oss-process=image%2Fformat%2Cwebp%2Fresize%2Cw_937%2Climit_0#averageHue=%23bec9d9&from=url&id=krPyj&originHeight=488&originWidth=937&originalType=binary&ratio=1.25&rotation=0&showTitle=false&status=done&style=stroke&title=)
## 二、AOP 实现原理
### 初始化
启动注解，@EnableAspectJAutoProxy 会引用（Import） AOP 代理注册器 AspectJAutoProxyRegistrar，该注册器会注册对象  AnnotationAwareAspectJAutoProxyCreator 
```java
@Target({ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Import({AspectJAutoProxyRegistrar.class})
public @interface EnableAspectJAutoProxy {
    boolean proxyTargetClass() default false;

    boolean exposeProxy() default false;
}

```

- 引入 AspectJAutoProxyRegistrar，来注册 AnnotationAwareAspectJAutoProxyCreator 这个 BeanDefinition，从而在 Spring 容器启动时会去创建出这个对象。

```java
class AspectJAutoProxyRegistrar implements ImportBeanDefinitionRegistrar {
    AspectJAutoProxyRegistrar() {
    }

    public void registerBeanDefinitions(AnnotationMetadata importingClassMetadata, BeanDefinitionRegistry registry) {
        AopConfigUtils.registerAspectJAnnotationAutoProxyCreatorIfNecessary(registry);
        AnnotationAttributes enableAspectJAutoProxy = AnnotationConfigUtils.attributesFor(importingClassMetadata, EnableAspectJAutoProxy.class);
        if (enableAspectJAutoProxy != null) {
            if (enableAspectJAutoProxy.getBoolean("proxyTargetClass")) {
                AopConfigUtils.forceAutoProxyCreatorToUseClassProxying(registry);
            }

            if (enableAspectJAutoProxy.getBoolean("exposeProxy")) {
                AopConfigUtils.forceAutoProxyCreatorToExposeProxy(registry);
            }
        }

    }
}

@Nullable
public static BeanDefinition registerAspectJAnnotationAutoProxyCreatorIfNecessary(
		BeanDefinitionRegistry registry, @Nullable Object source) {

	return registerOrEscalateApcAsRequired(AnnotationAwareAspectJAutoProxyCreator.class, registry, source);
}

@Nullable
private static BeanDefinition registerOrEscalateApcAsRequired(
		Class<?> cls, BeanDefinitionRegistry registry, @Nullable Object source) {

	Assert.notNull(registry, "BeanDefinitionRegistry must not be null");

	if (registry.containsBeanDefinition(AUTO_PROXY_CREATOR_BEAN_NAME)) {
		BeanDefinition apcDefinition = registry.getBeanDefinition(AUTO_PROXY_CREATOR_BEAN_NAME);
		if (!cls.getName().equals(apcDefinition.getBeanClassName())) {
			int currentPriority = findPriorityForClass(apcDefinition.getBeanClassName());
			int requiredPriority = findPriorityForClass(cls);
			if (currentPriority < requiredPriority) {
				apcDefinition.setBeanClassName(cls.getName());
			}
		}
		return null;
	}

	RootBeanDefinition beanDefinition = new RootBeanDefinition(cls);
	beanDefinition.setSource(source);
	beanDefinition.getPropertyValues().add("order", Ordered.HIGHEST_PRECEDENCE);
	beanDefinition.setRole(BeanDefinition.ROLE_INFRASTRUCTURE);
	registry.registerBeanDefinition(AUTO_PROXY_CREATOR_BEAN_NAME, beanDefinition);
	return beanDefinition;
}
```
### AnnotationAwareAspectJAutoProxyCreator 
这个创建器是一个 BeanPostProcessor <br />![image.png](https://cdn.nlark.com/yuque/0/2023/png/27416797/1695442836679-096b9816-54f2-42a3-b517-919dd8d400c8.png#averageHue=%23fcfbfb&clientId=ua9d85348-2f5f-4&from=paste&height=543&id=u59a11db3&originHeight=679&originWidth=1470&originalType=binary&ratio=1.25&rotation=0&showTitle=false&size=53309&status=done&style=stroke&taskId=u7fd44ee4-de2f-4fec-9d79-6a5152d5839&title=&width=1176)

在创建 Bean 时，即调用 doCreateBean 方法
```java
@Override
protected Object createBean(String beanName, RootBeanDefinition mbd, @Nullable Object[] args)
		throws BeanCreationException {

	if (logger.isTraceEnabled()) {
		logger.trace("Creating instance of bean '" + beanName + "'");
	}
	RootBeanDefinition mbdToUse = mbd;

	// Make sure bean class is actually resolved at this point, and
	// clone the bean definition in case of a dynamically resolved Class
	// which cannot be stored in the shared merged bean definition.
	Class<?> resolvedClass = resolveBeanClass(mbd, beanName);
	if (resolvedClass != null && !mbd.hasBeanClass() && mbd.getBeanClassName() != null) {
		mbdToUse = new RootBeanDefinition(mbd);
		mbdToUse.setBeanClass(resolvedClass);
	}

	// Prepare method overrides.
	try {
		mbdToUse.prepareMethodOverrides();
	}
	catch (BeanDefinitionValidationException ex) {
		throw new BeanDefinitionStoreException(mbdToUse.getResourceDescription(),
				beanName, "Validation of method overrides failed", ex);
	}

	try {
		// 通过 BeanPostProcess 创建代理对象
		// Give BeanPostProcessors a chance to return a proxy instead of the target bean instance.
		Object bean = resolveBeforeInstantiation(beanName, mbdToUse);
		if (bean != null) {
			return bean;
		}
	}
	catch (Throwable ex) {
		throw new BeanCreationException(mbdToUse.getResourceDescription(), beanName,
				"BeanPostProcessor before instantiation of bean failed", ex);
	}

	try {
		// 在 bean 真正创建前执行
		Object beanInstance = doCreateBean(beanName, mbdToUse, args);
		if (logger.isTraceEnabled()) {
			logger.trace("Finished creating instance of bean '" + beanName + "'");
		}
		return beanInstance;
	}
	catch (BeanCreationException | ImplicitlyAppearedSingletonException ex) {
		// A previously detected exception with proper bean creation context already,
		// or illegal singleton state to be communicated up to DefaultSingletonBeanRegistry.
		throw ex;
	}
	catch (Throwable ex) {
		throw new BeanCreationException(
				mbdToUse.getResourceDescription(), beanName, "Unexpected exception during bean creation", ex);
	}
}
```

在 doCreateBean 方法中会调用 initializeBean 方法
```java
protected Object doCreateBean(String beanName, RootBeanDefinition mbd, @Nullable Object[] args)
		throws BeanCreationException {

	// Instantiate the bean.
	BeanWrapper instanceWrapper = null;
	if (mbd.isSingleton()) {
		instanceWrapper = this.factoryBeanInstanceCache.remove(beanName);
	}
	if (instanceWrapper == null) {
		instanceWrapper = createBeanInstance(beanName, mbd, args);
	}
	//创建对象
	Object bean = instanceWrapper.getWrappedInstance();
	Class<?> beanType = instanceWrapper.getWrappedClass();
	if (beanType != NullBean.class) {
		mbd.resolvedTargetType = beanType;
	}

	// Allow post-processors to modify the merged bean definition.
	synchronized (mbd.postProcessingLock) {
		if (!mbd.postProcessed) {
			try {
				applyMergedBeanDefinitionPostProcessors(mbd, beanType, beanName);
			}
			catch (Throwable ex) {
				throw new BeanCreationException(mbd.getResourceDescription(), beanName,
						"Post-processing of merged bean definition failed", ex);
			}
			mbd.postProcessed = true;
		}
	}

	// Eagerly cache singletons to be able to resolve circular references
	// even when triggered by lifecycle interfaces like BeanFactoryAware.
	boolean earlySingletonExposure = (mbd.isSingleton() && this.allowCircularReferences &&
			isSingletonCurrentlyInCreation(beanName));
	if (earlySingletonExposure) {
		if (logger.isTraceEnabled()) {
			logger.trace("Eagerly caching bean '" + beanName +
					"' to allow for resolving potential circular references");
		}
		addSingletonFactory(beanName, () -> getEarlyBeanReference(beanName, mbd, bean));
	}

	// Initialize the bean instance.
	Object exposedObject = bean;
	try {
		populateBean(beanName, mbd, instanceWrapper);
		// 调用初始化方法
		exposedObject = initializeBean(beanName, exposedObject, mbd);
	}
	catch (Throwable ex) {
		if (ex instanceof BeanCreationException && beanName.equals(((BeanCreationException) ex).getBeanName())) {
			throw (BeanCreationException) ex;
		}
		else {
			throw new BeanCreationException(
					mbd.getResourceDescription(), beanName, "Initialization of bean failed", ex);
		}
	}

	if (earlySingletonExposure) {
		Object earlySingletonReference = getSingleton(beanName, false);
		if (earlySingletonReference != null) {
			if (exposedObject == bean) {
				exposedObject = earlySingletonReference;
			}
			else if (!this.allowRawInjectionDespiteWrapping && hasDependentBean(beanName)) {
				String[] dependentBeans = getDependentBeans(beanName);
				Set<String> actualDependentBeans = new LinkedHashSet<>(dependentBeans.length);
				for (String dependentBean : dependentBeans) {
					if (!removeSingletonIfCreatedForTypeCheckOnly(dependentBean)) {
						actualDependentBeans.add(dependentBean);
					}
				}
				if (!actualDependentBeans.isEmpty()) {
					throw new BeanCurrentlyInCreationException(beanName,
							"Bean with name '" + beanName + "' has been injected into other beans [" +
							StringUtils.collectionToCommaDelimitedString(actualDependentBeans) +
							"] in its raw version as part of a circular reference, but has eventually been " +
							"wrapped. This means that said other beans do not use the final version of the " +
							"bean. This is often the result of over-eager type matching - consider using " +
							"'getBeanNamesForType' with the 'allowEagerInit' flag turned off, for example.");
				}
			}
		}
	}

	// Register bean as disposable.
	try {
		registerDisposableBeanIfNecessary(beanName, bean, mbd);
	}
	catch (BeanDefinitionValidationException ex) {
		throw new BeanCreationException(
				mbd.getResourceDescription(), beanName, "Invalid destruction signature", ex);
	}

	return exposedObject;
}
```

在 initializeBean 方法中，会调用 BeanPostProcess 的后置处理器
```java
protected Object initializeBean(String beanName, Object bean, @Nullable RootBeanDefinition mbd) {
	if (System.getSecurityManager() != null) {
		AccessController.doPrivileged((PrivilegedAction<Object>) () -> {
			invokeAwareMethods(beanName, bean);
			return null;
		}, getAccessControlContext());
	}
	else {
		invokeAwareMethods(beanName, bean);
	}

	Object wrappedBean = bean;
	if (mbd == null || !mbd.isSynthetic()) {
		//执行前置处理器
		wrappedBean = applyBeanPostProcessorsBeforeInitialization(wrappedBean, beanName);
	}

	try {
		//执行初始化方法
		invokeInitMethods(beanName, wrappedBean, mbd);
	}
	catch (Throwable ex) {
		throw new BeanCreationException(
				(mbd != null ? mbd.getResourceDescription() : null),
				beanName, "Invocation of init method failed", ex);
	}
	if (mbd == null || !mbd.isSynthetic()) {
		// 调用后置处理器
		wrappedBean = applyBeanPostProcessorsAfterInitialization(wrappedBean, beanName);
	}

	return wrappedBean;
}

@Override
public Object applyBeanPostProcessorsAfterInitialization(Object existingBean, String beanName)
		throws BeansException {

	Object result = existingBean;
	// 获取所有的BeanPostProcess，调用after方法
	for (BeanPostProcessor processor : getBeanPostProcessors()) {
		Object current = processor.postProcessAfterInitialization(result, beanName);
		if (current == null) {
			return result;
		}
		result = current;
	}
	return result;
}

/**
 * Create a proxy with the configured interceptors if the bean is
 * identified as one to proxy by the subclass.
 * @see #getAdvicesAndAdvisorsForBean 
	 AbstractAutoProxyCreator实现的 after 方法
 */
@Override
public Object postProcessAfterInitialization(@Nullable Object bean, String beanName) {
	if (bean != null) {
		Object cacheKey = getCacheKey(bean.getClass(), beanName);
		if (this.earlyProxyReferences.remove(cacheKey) != bean) {
			return wrapIfNecessary(bean, beanName, cacheKey);
		}
	}
	return bean;
}

```

- 从文章开头得知，AnnotationAwareAspectJAutoProxyCreator 一个 BeanPostProcess，它的父类 AbstractAutoProxyCreator 实现了 after 方法，用于判断并包装代理对象；
- 所以，调用 getBeanPostProcessors 方法获取所有的 BeanPostProcess，分别调用它们的 after 方法；


接着就调用 wrapIfNecessary 方法
```java
protected Object wrapIfNecessary(Object bean, String beanName, Object cacheKey) {
	if (StringUtils.hasLength(beanName) && this.targetSourcedBeans.contains(beanName)) {
		return bean;
	}
	if (Boolean.FALSE.equals(this.advisedBeans.get(cacheKey))) {
		return bean;
	}
	if (isInfrastructureClass(bean.getClass()) || shouldSkip(bean.getClass(), beanName)) {
		this.advisedBeans.put(cacheKey, Boolean.FALSE);
		return bean;
	}

	// Create proxy if we have advice.
	// 获取所有的切面表达式配置类
	// 通过Advisor中的ClassFileter找到符合当前类的Advisor
	Object[] specificInterceptors = getAdvicesAndAdvisorsForBean(bean.getClass(), beanName, null);
	if (specificInterceptors != DO_NOT_PROXY) {
		this.advisedBeans.put(cacheKey, Boolean.TRUE);
		// 创建代理对象
		Object proxy = createProxy(
				bean.getClass(), beanName, specificInterceptors, new SingletonTargetSource(bean));
		this.proxyTypes.put(cacheKey, proxy.getClass());
		return proxy;
	}

	this.advisedBeans.put(cacheKey, Boolean.FALSE);
	return bean;
}

// 下面是mini-spring中的代码
protected Object wrapIfNecessary(Object bean, String beanName) {
	Class<?> aClass = bean.getClass();
	if (isInfrastructureClass(aClass)) {
		return null;
	}

	Map<String, AspectJExpressionPointCutAdvisor> pointcutAdvisorMap = beanFactory.getBeanOfType(AspectJExpressionPointCutAdvisor.class);

	for (Map.Entry<String, AspectJExpressionPointCutAdvisor> entry : pointcutAdvisorMap.entrySet()) {
		AspectJExpressionPointCutAdvisor pointcutAdvisor = entry.getValue();
		ClassFilter classFilter = pointcutAdvisor.getPointCut().getClassFilter();
		if (!classFilter.matches(aClass)) {
			continue;
		}

		AdvisedSupport advisedSupport = new AdvisedSupport();
		advisedSupport.setMethodMatcher(pointcutAdvisor.getPointCut().getMethodMatcher());
		advisedSupport.setTargetClass(bean);
		advisedSupport.setMethodInterceptor((MethodInterceptor) pointcutAdvisor.getAdvice());
		advisedSupport.setProxyTargetClass(true);

		return new ProxyFactory(advisedSupport).getProxy();
	}

	return bean;
}
```

- 它会在 Spring 容器通过 Advisor 中配置的 ClassFilter 中找到我们配置解析好的 AspectJExpressionPointcutAdvisor 切点表达式类，如果不为空就去**封装织入过程**，将**目标对象**、**增强方法的逻辑**、**方法匹配器**封装到 AdvisedSupport 中，然后就创建出一个新的代理对象。
- 代理对象在执行方法时，会根据 AdvisedSupport 中的方法匹配器进行匹配，如果当前调用的方法符合当前的匹配器，如果符合就去走增强方法的逻辑，否则就去走原来的逻辑。


接着就进行创建代理对象逻辑：
```java
protected Object createProxy(Class<?> beanClass, @Nullable String beanName,
		@Nullable Object[] specificInterceptors, TargetSource targetSource) {

	if (this.beanFactory instanceof ConfigurableListableBeanFactory) {
		AutoProxyUtils.exposeTargetClass((ConfigurableListableBeanFactory) this.beanFactory, beanName, beanClass);
	}

	ProxyFactory proxyFactory = new ProxyFactory();
	proxyFactory.copyFrom(this);

	if (!proxyFactory.isProxyTargetClass()) {
		if (shouldProxyTargetClass(beanClass, beanName)) {
			proxyFactory.setProxyTargetClass(true);
		}
		else {
			evaluateProxyInterfaces(beanClass, proxyFactory);
		}
	}
	// 设置原对象和增强逻辑
	Advisor[] advisors = buildAdvisors(beanName, specificInterceptors);
	proxyFactory.addAdvisors(advisors);
	proxyFactory.setTargetSource(targetSource);
	customizeProxyFactory(proxyFactory);

	proxyFactory.setFrozen(this.freezeProxy);
	if (advisorsPreFiltered()) {
		proxyFactory.setPreFiltered(true);
	}
	// 创建代理对象
	return proxyFactory.getProxy(getProxyClassLoader());
}
```


创建 AOP Proxy 对象，即选择使用 JDK 代理还是选择 Cglib 代理
```java
public Object getProxy(@Nullable ClassLoader classLoader) {
	return createAopProxy().getProxy(classLoader);
}


@SuppressWarnings("unchecked")
public static <T> T getProxy(Class<T> proxyInterface, Interceptor interceptor) {
	return (T) new ProxyFactory(proxyInterface, interceptor).getProxy();
}
// 两种创建代理对象的方式
public AopProxy createAopProxy(AdvisedSupport config) throws AopConfigException {
	if (config.isOptimize() || config.isProxyTargetClass() || hasNoUserSuppliedProxyInterfaces(config)) {
		Class<?> targetClass = config.getTargetClass();
		if (targetClass == null) {
			throw new AopConfigException("TargetSource cannot determine target class: " +
					"Either an interface or a target is required for proxy creation.");
		}
		if (targetClass.isInterface() || Proxy.isProxyClass(targetClass)) {
			return new JdkDynamicAopProxy(config);
		}
		return new ObjenesisCglibAopProxy(config);
	}
	else {
		return new JdkDynamicAopProxy(config);
	}
}
```

以 JDK 为例
```java
final class JdkDynamicAopProxy implements AopProxy, InvocationHandler, Serializable {
	@Override
	public Object getProxy(@Nullable ClassLoader classLoader) {
		if (logger.isTraceEnabled()) {
			logger.trace("Creating JDK dynamic proxy: " + this.advised.getTargetSource());
		}
		Class<?>[] proxiedInterfaces = AopProxyUtils.completeProxiedInterfaces(this.advised, true);
		findDefinedEqualsAndHashCodeMethods(proxiedInterfaces);
		return Proxy.newProxyInstance(classLoader, proxiedInterfaces, this);
	}

	@Override
	@Nullable
	public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
		Object oldProxy = null;
		boolean setProxyContext = false;

		TargetSource targetSource = this.advised.targetSource;
		Object target = null;

		try {
			// ...
			Object retVal;

			if (this.advised.exposeProxy) {
				// Make invocation available if necessary.
				oldProxy = AopContext.setCurrentProxy(proxy);
				setProxyContext = true;
			}

			target = targetSource.getTarget();
			Class<?> targetClass = (target != null ? target.getClass() : null);

			// Get the interception chain for this method. 即获取 MethodInterceptor
			List<Object> chain = this.advised.getInterceptorsAndDynamicInterceptionAdvice(method, targetClass);

			if (chain.isEmpty()) {
			}
			else {
				// 增强方法
				MethodInvocation invocation =
						new ReflectiveMethodInvocation(proxy, target, method, args, targetClass, chain);
				// 最终的反射调用
				retVal = invocation.proceed();
			}

			// ...
			return retVal;
		}
		finally {
			if (target != null && !targetSource.isStatic()) {
				// Must have come from TargetSource.
				targetSource.releaseTarget(target);
			}
			if (setProxyContext) {
				// Restore old proxy.
				AopContext.setCurrentProxy(oldProxy);
			}
		}
	}
}
```

这个 proceed() 会去判断该方法是否需要代理，然后调用 织入方法 + 原本的方法（织入方法 + 原本的方法 其实是被封装到 MethodIntercept 里面）
```java
@Override
@Nullable
public Object proceed() throws Throwable {
	// We start with an index of -1 and increment early.
	if (this.currentInterceptorIndex == this.interceptorsAndDynamicMethodMatchers.size() - 1) {
		return invokeJoinpoint();
	}

	Object interceptorOrInterceptionAdvice =
			this.interceptorsAndDynamicMethodMatchers.get(++this.currentInterceptorIndex);
	if (interceptorOrInterceptionAdvice instanceof InterceptorAndDynamicMethodMatcher) {
		// Evaluate dynamic method matcher here: static part will already have
		// been evaluated and found to match.
		InterceptorAndDynamicMethodMatcher dm =
				(InterceptorAndDynamicMethodMatcher) interceptorOrInterceptionAdvice;
		Class<?> targetClass = (this.targetClass != null ? this.targetClass : this.method.getDeclaringClass());
		// 判断对象是否需要代理
		if (dm.methodMatcher.matches(this.method, targetClass, this.arguments)) {
			// 执行强化方法和原本的方法
			return dm.interceptor.invoke(this);
		}
		else {
			// Dynamic matching failed.
			// Skip this interceptor and invoke the next in the chain.
			return proceed();
		}
	}
	else {
		// It's an interceptor, so we just invoke it: The pointcut will have
		// been evaluated statically before this object was constructed.
		return ((MethodInterceptor) interceptorOrInterceptionAdvice).invoke(this);
	}
}
```

总的来说，AOP 基于 BeanPostProcess 和 动态代理实现的。
## 三、AOP 的应用

1. 对每一个 Controller 请求方法设置切面，记录入参和出参，方法耗时；
2. 参考自己实现的 AOP 注解 + 滑动窗口限流计数器；
3. 基于 AOP 注解实现用户的鉴权，比如说通过 AOP 获取当前的请求中携带的 Token，从而实现鉴权处理；
