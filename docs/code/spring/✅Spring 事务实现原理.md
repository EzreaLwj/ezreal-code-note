# Transactional 事务注解实现原理 
## 一、Transactional 事务注解是什么

Transactional 注解是 Spring 容器中提供给开发者进行事务控制的注解，大大方便了开发人员进行数据库事务的控制。但是大多数开发者并不了解它的底层实现原理，导致在使用该注解的时候常常犯错。那么这篇文章就带领读取揭开 Transactional 注解的底层面貌，正确的使用 Transactional 注解。

## 二、Transactional 事务注解实现原理源码剖析

### 2.1 Transactional 事务注解的启动

Transactional 事务注解的开启需要我们在 SpringBoot 的启动类中添加 @EnableTransactionManagement 注解。

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Import(TransactionManagementConfigurationSelector.class)
public @interface EnableTransactionManagement {

	boolean proxyTargetClass() default false;

	AdviceMode mode() default AdviceMode.PROXY;

	int order() default Ordered.LOWEST_PRECEDENCE;

}
```

该注解通过 **Import 注解**向容器注入了 **TransactionManagementConfigurationSelector** 类

```java
public class TransactionManagementConfigurationSelector extends AdviceModeImportSelector<EnableTransactionManagement> {

	@Override
	protected String[] selectImports(AdviceMode adviceMode) {
		switch (adviceMode) {
			case PROXY:
				return new String[] {AutoProxyRegistrar.class.getName(),
						ProxyTransactionManagementConfiguration.class.getName()};
			case ASPECTJ:
				return new String[] {determineTransactionAspectClass()};
			default:
				return null;
		}
	}

	private String determineTransactionAspectClass() {
		return (ClassUtils.isPresent("javax.transaction.Transactional", getClass().getClassLoader()) ?
				TransactionManagementConfigUtils.JTA_TRANSACTION_ASPECT_CONFIGURATION_CLASS_NAME :
				TransactionManagementConfigUtils.TRANSACTION_ASPECT_CONFIGURATION_CLASS_NAME);
	}

}
```

- 这个实现了 ImportSelector 接口，通过 selectImports 方法可以向容器中注入我们想要的类；
- 而 TransactionManagementConfigurationSelector 则通过 selectImports 方法向容器中注入 **AutoProxyRegistrar** 和  **ProxyTransactionManagementConfiguration** 类；

### 2.2 创建为 Transactional 注解解析的 AOP 环境

在 2.1 中我们提到，TransactionManagementConfigurationSelector 引入了 **AutoProxyRegistrar** 和 **ProxyTransactionManagementConfiguration** 类，这两个类的作用就是为创建 Transactional 注解的代理对象作准备。

#### 2.2.1 解析 AutoProxyRegistrar

AutoProxyRegisrar 的作用是为容器创建 AutoProxyCreator 类，该的作用就是向容器中写入 InfrastructureAdvisorAutoProxyCreator 的 BeanDefinition，便于 Spring 创建时提前解析。

```java
public class AutoProxyRegistrar implements ImportBeanDefinitionRegistrar {

	private final Log logger = LogFactory.getLog(getClass());

	@Override
	public void registerBeanDefinitions(AnnotationMetadata importingClassMetadata, BeanDefinitionRegistry registry) {
		boolean candidateFound = false;
		Set<String> annTypes = importingClassMetadata.getAnnotationTypes();
		for (String annType : annTypes) {
			AnnotationAttributes candidate = AnnotationConfigUtils.attributesFor(importingClassMetadata, annType);
			if (candidate == null) {
				continue;
			}
			Object mode = candidate.get("mode");
			Object proxyTargetClass = candidate.get("proxyTargetClass");
			if (mode != null && proxyTargetClass != null && AdviceMode.class == mode.getClass() &&
					Boolean.class == proxyTargetClass.getClass()) {
				candidateFound = true;
				if (mode == AdviceMode.PROXY) {
                    // 注入AutoProxyCreator类，默认实现是InfrastructureAdvisorAutoProxyCreator类
					AopConfigUtils.registerAutoProxyCreatorIfNecessary(registry);
					if ((Boolean) proxyTargetClass) {
						AopConfigUtils.forceAutoProxyCreatorToUseClassProxying(registry);
						return;
					}
				}
			}
		}
    }
}
```

而 InfrastructureAdvisorAutoProxyCreator 类是一个后置处理器，在 Bean 创建完成后，会调用 InfrastructureAdvisorAutoProxyCreator  的父类 AbstractAutoProxyCreator  的 **postProcessAfterInitialization**方法 来创建代理对象。

```java
@Override
public Object postProcessAfterInitialization(@Nullable Object bean, String beanName) {
    if (bean != null) {
        Object cacheKey = getCacheKey(bean.getClass(), beanName);
        if (this.earlyProxyReferences.remove(cacheKey) != bean) {
            // 创建代理对象
            return wrapIfNecessary(bean, beanName, cacheKey);
        }
    }
    return bean;
}
```

#### 2.2.2 解析 ProxyTransactionManagementConfiguration

ProxyTransactionManagementConfiguration 中包含了实现了 Transaction 代理对象的配置信息，包括装配**织入对象**，**方法TransactionInterceptor** 和 **TransactionArrtibuteSource**

```java
@Configuration(proxyBeanMethods = false)
@Role(BeanDefinition.ROLE_INFRASTRUCTURE)
public class ProxyTransactionManagementConfiguration extends AbstractTransactionManagementConfiguration {
	
    //配置BeanFactoryTransactionAttributeSourceAdvisor织入对象
	@Bean(name = TransactionManagementConfigUtils.TRANSACTION_ADVISOR_BEAN_NAME)
	@Role(BeanDefinition.ROLE_INFRASTRUCTURE)
    //这里是通过方法参数注入
	public BeanFactoryTransactionAttributeSourceAdvisor transactionAdvisor(
			TransactionAttributeSource transactionAttributeSource, TransactionInterceptor transactionInterceptor) {

		BeanFactoryTransactionAttributeSourceAdvisor advisor = new BeanFactoryTransactionAttributeSourceAdvisor();
		advisor.setTransactionAttributeSource(transactionAttributeSource);
		advisor.setAdvice(transactionInterceptor);
		if (this.enableTx != null) {
			advisor.setOrder(this.enableTx.<Integer>getNumber("order"));
		}
		return advisor;
	}

    //事务属性解析器
	@Bean
	@Role(BeanDefinition.ROLE_INFRASTRUCTURE)
	public TransactionAttributeSource transactionAttributeSource() {
		return new AnnotationTransactionAttributeSource();
	}

    //事务方法执行器
	@Bean
	@Role(BeanDefinition.ROLE_INFRASTRUCTURE)
	public TransactionInterceptor transactionInterceptor(TransactionAttributeSource transactionAttributeSource) {
		TransactionInterceptor interceptor = new TransactionInterceptor();
		interceptor.setTransactionAttributeSource(transactionAttributeSource);
		if (this.txManager != null) {
			interceptor.setTransactionManager(this.txManager);
		}
		return interceptor;
	}

}
```

##### **TransactionAttributeSource 类**

**TransactionAttributeSource** 类的作用是用来**解析 Transactional 注解**，AnnotationTransactionAttributeSource 是它的一个实现类。它里面包含了一个 **TransactionAnnotationParser** 类，它可以帮助我们获取 Transactional 注解上的信息，其中 **SpringTransactionAnnotationParser** 是它的一个实现类：

```java
public class SpringTransactionAnnotationParser implements TransactionAnnotationParser, Serializable {

	@Override
	public boolean isCandidateClass(Class<?> targetClass) {
		return AnnotationUtils.isCandidateClass(targetClass, Transactional.class);
	}

	@Override
	@Nullable
	public TransactionAttribute parseTransactionAnnotation(AnnotatedElement element) {
		AnnotationAttributes attributes = AnnotatedElementUtils.findMergedAnnotationAttributes(
				element, Transactional.class, false, false);
		if (attributes != null) {
			return parseTransactionAnnotation(attributes);
		}
		else {
			return null;
		}
	}

	public TransactionAttribute parseTransactionAnnotation(Transactional ann) {
		return parseTransactionAnnotation(AnnotationUtils.getAnnotationAttributes(ann, false, false));
	}
	// 解析Transactional注解中的信息
	protected TransactionAttribute parseTransactionAnnotation(AnnotationAttributes attributes) {
		RuleBasedTransactionAttribute rbta = new RuleBasedTransactionAttribute();

		Propagation propagation = attributes.getEnum("propagation");
		rbta.setPropagationBehavior(propagation.value());
		Isolation isolation = attributes.getEnum("isolation");
		rbta.setIsolationLevel(isolation.value());
		rbta.setTimeout(attributes.getNumber("timeout").intValue());
		rbta.setReadOnly(attributes.getBoolean("readOnly"));
		rbta.setQualifier(attributes.getString("value"));

		List<RollbackRuleAttribute> rollbackRules = new ArrayList<>();
		for (Class<?> rbRule : attributes.getClassArray("rollbackFor")) {
			rollbackRules.add(new RollbackRuleAttribute(rbRule));
		}
		for (String rbRule : attributes.getStringArray("rollbackForClassName")) {
			rollbackRules.add(new RollbackRuleAttribute(rbRule));
		}
		for (Class<?> rbRule : attributes.getClassArray("noRollbackFor")) {
			rollbackRules.add(new NoRollbackRuleAttribute(rbRule));
		}
		for (String rbRule : attributes.getStringArray("noRollbackForClassName")) {
			rollbackRules.add(new NoRollbackRuleAttribute(rbRule));
		}
		rbta.setRollbackRules(rollbackRules);

		return rbta;
	}
}
```

同时，TransactionAttributeSource 类结合 Parse 提供了 findTransactionAttribute 方法，可以用于解析类中或者方法上的 Transactional 注解：

```java
public class SpringTransactionAnnotationParser implements TransactionAnnotationParser, Serializable {
    @Override
    @Nullable
    // 解析类中的Transactional注解
    protected TransactionAttribute findTransactionAttribute(Class<?> clazz) {
        return determineTransactionAttribute(clazz);
    }

    @Override
    @Nullable
    // 解析方法上的Transactional注解
    protected TransactionAttribute findTransactionAttribute(Method method) {
        return determineTransactionAttribute(method);
    }
    @Nullable
    protected TransactionAttribute determineTransactionAttribute(AnnotatedElement element) {
        //调用parser类进行解析Transactional中的信息
        for (TransactionAnnotationParser parser : this.annotationParsers) {
            TransactionAttribute attr = parser.parseTransactionAnnotation(element);
            if (attr != null) {
                return attr;
            }
        }
        return null;
    }
}
```

- 通过方法重载的方式，方法 findTransactionAttribute 即可以解析类上的注解也可以解析方法上的注解；

##### **织入对象 BeanFactoryTransactionAttributeSourceAdvisor**

BeanFactoryTransactionAttributeSourceAdvisor 是织入对象，包含了切入点 **TransactionAttributeSourcePointcut** 和 **TransactionAttributeSource**，两者**结合实现 Transactional 注解的定位**，决定是否生成代理对象，主要作用于 **Class 匹配器**和 **Method 匹配器**。

TransactionAttributeSourcePointcut 的 **Method 匹配器**

```java
abstract class TransactionAttributeSourcePointcut extends StaticMethodMatcherPointcut implements Serializable {

	@Override
	public boolean matches(Method method, Class<?> targetClass) {
        //获取事务资源解析器
		TransactionAttributeSource tas = getTransactionAttributeSource();
        //调用父类的getTransactionAttribute
		return (tas == null || tas.getTransactionAttribute(method, targetClass) != null);
	}

	//...
}
```

- TransactionAttributeSourcePointcut 实现了 MethodMatcher 接口，重写 matches 方法，自定义了方法匹配器；
- 它调用 AnnotationTransactionAttributeSource 父类 AbstractFallbackTransactionAttributeSource 的 getTransactionAttributeSource 方法，尝试获取 TransactionAttribute 事务属性，如果获取不到就说明该方法不是 Transactional 注解标注的对象；

TransactionAttributeSourcePointcut 的 **Class 匹配器**

```java
abstract class TransactionAttributeSourcePointcut extends StaticMethodMatcherPointcut implements Serializable {
    protected TransactionAttributeSourcePointcut() {
		setClassFilter(new TransactionAttributeSourceClassFilter());
	}

	private class TransactionAttributeSourceClassFilter implements ClassFilter {

		@Override
		public boolean matches(Class<?> clazz) {
			if (TransactionalProxy.class.isAssignableFrom(clazz) ||
					TransactionManager.class.isAssignableFrom(clazz) ||
					PersistenceExceptionTranslator.class.isAssignableFrom(clazz)) {
				return false;
			}
             //获取资源的解析器
			TransactionAttributeSource tas = getTransactionAttributeSource();
			return (tas == null || tas.isCandidateClass(clazz));
		}
	}
}
```

- TransactionAttributeSourcePointcut 通过 TransactionAttributeSourceClassFilter 内部类，定义了一个类匹配器；
- 它通过 TransactionAttributeSource 的 isCandidateClass 方法判断该类是否标注了 [@Transactional ](/Transactional ) 注解； 

##### TransactionInterceptor

TransactionInterceptor 是 Advice 增强方法，它实现了 MethodIntercept 接口，该接口又继承了 Advice 接口，它的 invoke 方法中定义了一系列的事务的执行逻辑，

```java
public class TransactionInterceptor extends TransactionAspectSupport implements MethodInterceptor, Serializable {
    @Override
    @Nullable
    public Object invoke(MethodInvocation invocation) throws Throwable {
        // Work out the target class: may be {@code null}.
        // The TransactionAttributeSource should be passed the target class
        // as well as the method, which may be from an interface.
        Class<?> targetClass = (invocation.getThis() != null ? AopUtils.getTargetClass(invocation.getThis()) : null);

        // Adapt to TransactionAspectSupport's invokeWithinTransaction...
        return invokeWithinTransaction(invocation.getMethod(), targetClass, invocation::proceed);
    }
}
```

- invokeWithinTransaction 方法是真正调用事务的方法；

invokeWithinTransaction 执行事务方法：

```java
@Nullable
protected Object invokeWithinTransaction(Method method, @Nullable Class<?> targetClass,
        final InvocationCallback invocation) throws Throwable {

    // If the transaction attribute is null, the method is non-transactional.
    TransactionAttributeSource tas = getTransactionAttributeSource();
    final TransactionAttribute txAttr = (tas != null ? tas.getTransactionAttribute(method, targetClass) : null);
    final TransactionManager tm = determineTransactionManager(txAttr);

    PlatformTransactionManager ptm = asPlatformTransactionManager(tm);
    final String joinpointIdentification = methodIdentification(method, targetClass, txAttr);

    if (txAttr == null || !(ptm instanceof CallbackPreferringPlatformTransactionManager)) {
        // Standard transaction demarcation with getTransaction and commit/rollback calls.
        // 1.获取连接，开启事务
        TransactionInfo txInfo = createTransactionIfNecessary(ptm, txAttr, joinpointIdentification);

        Object retVal;
        try {
            // This is an around advice: Invoke the next interceptor in the chain.
            // This will normally result in a target object being invoked.
            retVal = invocation.proceedWithInvocation(); // 2.调用原来的方法 
        }
        catch (Throwable ex) {
            // target invocation exception
            completeTransactionAfterThrowing(txInfo, ex);//3.捕获异常，回滚事务
            throw ex;
        }
        finally {
            cleanupTransactionInfo(txInfo);
        }

        if (retVal != null && vavrPresent && VavrDelegate.isVavrTry(retVal)) {
            // Set rollback-only in case of Vavr failure matching our rollback rules...
            TransactionStatus status = txInfo.getTransactionStatus();
            if (status != null && txAttr != null) {
                retVal = VavrDelegate.evaluateTryFailure(retVal, txAttr, status);
            }
        }

        commitTransactionAfterReturning(txInfo); //4.正常执行，提交事务
        return retVal;
    }
}
```

- 这里的操作可以分为四个步骤： 
   - 获取数据库连接，开启事务
   - 执行原来的方法、捕获异常；
   - 回滚事务；
   - 正常执行，提交事务；

### 2.3 创建 Transactional 代理对象

其实，这是 **Spring AOP 中创建代理对象的过程**，我们来走一遍。

#### 2.3.1 执行后置处理器

在 Spring 容器创建完 Bean 之后，执行我们之前注册的 InfrastructureAdvisorAutoProxyCreator  后置处理器

```java
public abstract class AbstractAutoProxyCreator extends ProxyProcessorSupport
		implements SmartInstantiationAwareBeanPostProcessor, BeanFactoryAware {
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
}
```

#### 2.3.2 识别并包装 Transactional 代理对象

在 wrap 方法中，会获取所有匹配（根据方法匹配器和类匹配器进行匹配）当前类的 Advisor 对象，在 Transactional 事务注解中会获取到我们定义的 **BeanFactoryTransactionAttributeSourceAdvisor** ，然后就创建 AOP 代理对象；

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
    // 获取所有适合的Advisor对象
    Object[] specificInterceptors = getAdvicesAndAdvisorsForBean(bean.getClass(), beanName, null);
    if (specificInterceptors != DO_NOT_PROXY) {
        this.advisedBeans.put(cacheKey, Boolean.TRUE);
        //创建代理对象
        Object proxy = createProxy(
                bean.getClass(), beanName, specificInterceptors, new SingletonTargetSource(bean));
        this.proxyTypes.put(cacheKey, proxy.getClass());
        return proxy;
    }

    this.advisedBeans.put(cacheKey, Boolean.FALSE);
    return bean;
}
```

我们来看看 getAdvicesAndAdvisorsForBean 方法，这个方法最终是通过 AopUtils 获取适合的 Advisor 对象

```java
@Override
@Nullable
protected Object[] getAdvicesAndAdvisorsForBean(
        Class<?> beanClass, String beanName, @Nullable TargetSource targetSource) {
	//获取织入对象
    List<Advisor> advisors = findEligibleAdvisors(beanClass, beanName);
    if (advisors.isEmpty()) {
        return DO_NOT_PROXY;
    }
    return advisors.toArray();
}

protected List<Advisor> findEligibleAdvisors(Class<?> beanClass, String beanName) {
    //寻找实现了Advisor接口的Bean
    List<Advisor> candidateAdvisors = findCandidateAdvisors();
    //继续获取织入对象 寻找实现Advisor注解的类
    List<Advisor> eligibleAdvisors = findAdvisorsThatCanApply(candidateAdvisors, beanClass, beanName);
    extendAdvisors(eligibleAdvisors);
    if (!eligibleAdvisors.isEmpty()) {
        //对织入对象进行排序
        eligibleAdvisors = sortAdvisors(eligibleAdvisors);
    }
    return eligibleAdvisors;
}
protected List<Advisor> findAdvisorsThatCanApply(
			List<Advisor> candidateAdvisors, Class<?> beanClass, String beanName) {

    ProxyCreationContext.setCurrentProxiedBeanName(beanName);
    try {
       	// 最后通过AopUtils工具类获取适合的Advisor对象
        return AopUtils.findAdvisorsThatCanApply(candidateAdvisors, beanClass);
    }
    finally {
        ProxyCreationContext.setCurrentProxiedBeanName(null);
    }
}
```

我们再看看 AopUtils 是如何获取适合的 Adviosr 对象的，它是靠 AopUtils 中的 canApply 方法来判断的：

```java
public static boolean canApply(Pointcut pc, Class<?> targetClass, boolean hasIntroductions) {
    Assert.notNull(pc, "Pointcut must not be null");
    // 首先通过类匹配器进行匹配
    if (!pc.getClassFilter().matches(targetClass)) {
        return false;
    }

    MethodMatcher methodMatcher = pc.getMethodMatcher();
    if (methodMatcher == MethodMatcher.TRUE) {
        // No need to iterate the methods if we're matching any method anyway...
        return true;
    }

    IntroductionAwareMethodMatcher introductionAwareMethodMatcher = null;
    if (methodMatcher instanceof IntroductionAwareMethodMatcher) {
        introductionAwareMethodMatcher = (IntroductionAwareMethodMatcher) methodMatcher;
    }

    Set<Class<?>> classes = new LinkedHashSet<>();
    if (!Proxy.isProxyClass(targetClass)) {
        classes.add(ClassUtils.getUserClass(targetClass));
    }
    classes.addAll(ClassUtils.getAllInterfacesForClassAsSet(targetClass));

    // 然后通过方法匹配器进行匹配
    for (Class<?> clazz : classes) {
        Method[] methods = ReflectionUtils.getAllDeclaredMethods(clazz);
        for (Method method : methods) {
            if (introductionAwareMethodMatcher != null ?
                    introductionAwareMethodMatcher.matches(method, targetClass, hasIntroductions) :
                    methodMatcher.matches(method, targetClass)) {
                return true;
            }
        }
    }

    return false;
}
```

获取到的适合的 Advisor 后，即 BeanFactoryTransactionAttributeSourceAdvisor，我们就可以创建代理对象了：

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
	
    // 提取Adviosrs
    Advisor[] advisors = buildAdvisors(beanName, specificInterceptors);
    // 设置代理类信息
    proxyFactory.addAdvisors(advisors);
    proxyFactory.setTargetSource(targetSource);
    customizeProxyFactory(proxyFactory);

    proxyFactory.setFrozen(this.freezeProxy);
    if (advisorsPreFiltered()) {
        proxyFactory.setPreFiltered(true);
    }

    return proxyFactory.getProxy(getProxyClassLoader());
}
```

- 创建出代理对象后，我们含有 Transactional 注解的类就实现事务的控制了。

### 2.4 执行 Transactional 标记的方法

当我们执行原本的方法时，会进入代理对象逻辑，这里以 JDK 实现的代理对象为例：

```java
final class JdkDynamicAopProxy implements AopProxy, InvocationHandler, Serializable {
    @Override
    @Nullable
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
       
        	//从advised中获取方法匹配器
            List<Object> chain = this.advised.getInterceptorsAndDynamicInterceptionAdvice(method, targetClass);

            // Check whether we have any advice. If we don't, we can fallback on direct
            // reflective invocation of the target, and avoid creating a MethodInvocation.
            if (chain.isEmpty()) {
                // We can skip creating a MethodInvocation: just invoke the target directly
                // Note that the final invoker must be an InvokerInterceptor so we know it does
                // nothing but a reflective operation on the target, and no hot swapping or fancy proxying.
                Object[] argsToUse = AopProxyUtils.adaptArgumentsIfNecessary(method, args);
                retVal = AopUtils.invokeJoinpointUsingReflection(target, method, argsToUse);
            }
            else {
                // We need to create a method invocation...
                // 封装MethodInvocation，调用proceed方法，返回结果对象
                MethodInvocation invocation =
                        new ReflectiveMethodInvocation(proxy, target, method, args, targetClass, chain);
                // Proceed to the joinpoint through the interceptor chain.
                retVal = invocation.proceed();
            }
           
    }
}
```

- 封装为 MethodInvocation 对象，传入**原本的对象**，**方法**，**参数**，**原本对象的 class 对象**，**方法匹配器**，然后调用 proceed 方法；

最后执行方法的调用：
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
        //对方法进行匹配，然后执行增强方法部分的逻辑
        if (dm.methodMatcher.matches(this.method, targetClass, this.arguments)) {
            return dm.interceptor.invoke(this);
        }
        else {
			//执行原来的方法
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

## 三、Transactional 注解失效的情况

### 3.1 底层数据库引擎不支持事务

这没什么好说的，数据库不支持事务，即使标注了 Transactional 注解，事务方法也不会生效。

### 3.2 非 public 方法上标记 Transactional 注解

在 **TransactionAttributeSourcePointcut** 类中进行**方法匹配**时，都会调用 **TransactionAttributeSource** 的 **getTransactionAttribute** 方法

```java
@SuppressWarnings("serial")
abstract class TransactionAttributeSourcePointcut extends StaticMethodMatcherPointcut implements Serializable {
	@Override
	public boolean matches(Method method, Class<?> targetClass) {
		TransactionAttributeSource tas = getTransactionAttributeSource();
		return (tas == null || tas.getTransactionAttribute(method, targetClass) != null);
	}
}
@Override
@Nullable
public TransactionAttribute getTransactionAttribute(Method method, @Nullable Class<?> targetClass) {
    if (method.getDeclaringClass() == Object.class) {
        return null;
    }

    Object cacheKey = getCacheKey(method, targetClass);
    TransactionAttribute cached = this.attributeCache.get(cacheKey);
    //先从缓存中获取事务属性，如果没有就去创建
    if (cached != null) {
        if (cached == NULL_TRANSACTION_ATTRIBUTE) {
            return null;
        }
        else {
            return cached;
        }
    }
    else {
        // 创建事务属性
        // We need to work it out.
        TransactionAttribute txAttr = computeTransactionAttribute(method, targetClass);
        // ...
        return txAttr;
    }
}
```

创建事务属性的方法是 computeTransactionAttribute 方法：

```java
@Nullable
protected TransactionAttribute computeTransactionAttribute(Method method, @Nullable Class<?> targetClass) {
    // Don't allow no-public methods as required.
    if (allowPublicMethodsOnly() && !Modifier.isPublic(method.getModifiers())) {
        return null;
    }
}
```

- 可见，如果不是 public 方法，就会返回 null，进而匹配失败，无法创建代理对象；

### 3.3 异常没抛出或者在事务方法内部捕获了异常

在 invokeWithinTransaction 方法中，是根据抛出异常来回滚操作的，也就是 rollback 代码是写在 catch 代码块中的，如果外层的代码没有 catch 住异常，那么事务就不会回滚，而是直接提交，导致事务失效。

```java
protected Object invokeWithinTransaction(Method method, @Nullable Class<?> targetClass,
        final InvocationCallback invocation) throws Throwable {
    
    PlatformTransactionManager ptm = asPlatformTransactionManager(tm);
    final String joinpointIdentification = methodIdentification(method, targetClass, txAttr);

    if (txAttr == null || !(ptm instanceof CallbackPreferringPlatformTransactionManager)) {
        // Standard transaction demarcation with getTransaction and commit/rollback calls.
        TransactionInfo txInfo = createTransactionIfNecessary(ptm, txAttr, joinpointIdentification);

        Object retVal;
        try {
            // This is an around advice: Invoke the next interceptor in the chain.
            // This will normally result in a target object being invoked.
            retVal = invocation.proceedWithInvocation(); // 执行原来的方法
        }
        catch (Throwable ex) {
            // target invocation exception 捕获住异常并且回滚
            completeTransactionAfterThrowing(txInfo, ex);
            throw ex;
        }
        finally {
            cleanupTransactionInfo(txInfo);
        }

        if (retVal != null && vavrPresent && VavrDelegate.isVavrTry(retVal)) {
            // Set rollback-only in case of Vavr failure matching our rollback rules...
            TransactionStatus status = txInfo.getTransactionStatus();
            if (status != null && txAttr != null) {
                retVal = VavrDelegate.evaluateTryFailure(retVal, txAttr, status);
            }
        }
		// 提交事务
        commitTransactionAfterReturning(txInfo);
        return retVal;
    }
       //...
    }
}
```

### 3.4 方法中调用同类的方法

一个类中的方法 A，没有标注 Transactional 注解，在方法内调用一个被 Transactional 注解修饰的方法 B，此时这会导致方法 B 的事务失效。

这是因为 Spring AOP 的原因，只有当前的事务方法被当前类以外的方法进行调用时，事务方法才会生效。因为在同类调用事务方式，调用的方式是 this.B()，this 是指原本的对象，而不是一个代理对象，无法进入到 TransactionInterceptor 增强的逻辑，所以事务无法生效。

### 3.5 rollbackFor 设置错误

事务方法抛出异常如果与 rollbackFor 设置的异常不一致，那么当前事务也不会进行回滚操作，事务失效。

### 3.6 事务的传播机制设置错误

事务的传播机制关于一个事务方法调用另一个事务方法时，当前数据库的事务要如何处理，是共享一个新事务，还是各使用一个事务，还是一个开启，另一个不开启。

对于事务传播机制的设置，以下情况可能会导致事务失效：

- TransactionDefinition.PROPAGATION_NEVER：以非事务运行，如果存在事务就抛出异常；
- TransactionDefinition.SUPPORT：如果存在事务就加入当前事务，没有就普通运行；
- TransactionDefinition.NOT_SUPPORT：如果存在事务就暂停事务，没有就普通运行
