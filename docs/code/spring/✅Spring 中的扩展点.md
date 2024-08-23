### 自定义拦截器
SpringMVC 中提供了拦截器 Interceptor 机制，对应的接口是 HandlerInterceptor：
```java
public interface HandlerInterceptor {
	default boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
			throws Exception {

		return true;
	}

	default void postHandle(HttpServletRequest request, HttpServletResponse response, Object handler,
			@Nullable ModelAndView modelAndView) throws Exception {
	}

	default void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler,
			@Nullable Exception ex) throws Exception {
	}

}
```

- 可以对请求进行额外的处理；

### 获取 Spring 容器对象
在 Spring 中提供了很多的 Aware 接口，例如：BeanFactoryAware，ApplicationContextAware 等，可以获取 Spring 中底层内部中的类，比如 BeanFactory，ApplicationContext 等；
```java
public interface BeanFactoryAware extends Aware {

	void setBeanFactory(BeanFactory beanFactory) throws BeansException;

}

```

### 全局异常处理器
在 SpringBoot 中，提供了 RestControllerAdvice 注解，可以处理指定的异常情况：
```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(Exception.class)
    public String handleException(Exception e) {
        if (e instanceof ArithmeticException) {
            return "数据异常";
        }
        if (e instanceof Exception) {
            return "服务器内部异常";
        }
        retur nnull;
    }
}
```

### 导入配置
我们需要**在某个配置类中引入另外一些类**，被引入的类也加到 Spring 中，这时可以使用 import 注解；
```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Import(TransactionManagementConfigurationSelector.class)
public @interface EnableTransactionManagement {
pecting one type of proxy vs another, e.g. in tests.
	 */
	boolean proxyTargetClass() default false;

	AdviceMode mode() default AdviceMode.PROXY;

	int order() default Ordered.LOWEST_PRECEDENCE;
}

```

- 通过 Import 注解引入类 TransactionManagementConfigurationSelector

也可以使用 ImprotSelector 接口：
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

- 通过在 String 数组中写入类的全路径引入对应的类

也可以使用 ImportBeanDefinitionRegistrar 接口：
```java
public class AImportBeanDefinitionRegistrar implements ImportBeanDefinitionRegistrar {
    @Override
    public void registerBeanDefinitions(AnnotationMetadata importingClassMetadata, BeanDefinitionRegistry registry) {
        RootBeanDefinition rootBeanDefinition = new RootBeanDefinition(A.class);
        registry.registerBeanDefinition("a", rootBeanDefinition);
    }
}

@Import(AImportBeanDefinitionRegistrar.class)
@Configuration
public class TestConfiguration {
}

```

- 通过引入 RootBeanDefinition 类信息，在创建 Bean 时会自动找到该 BeanDefinition 进行反射创建

### 项目启动时
在 SpringBoot 启动时，提供了两个启动时定制化的接口：

- CommandLineRunner
- ApplicationRunner
```java
@Component
public class TestRunner implements ApplicationRunner {

    @Autowired
    private LoadDataService loadDataService;

    public void run(ApplicationArguments args) throws Exception {
        loadDataService.load();
    }
}
```

### 修改 BeanDefinition
Spring IOC 在实例化 Bean 对象之前，需要先读取 Bean 的相关属性，保存到 BeanDefinition 中，如果我们想修改 BeanDefinition，我们可以实现 BeanFactoryPostProcessor 接口：
```java
@Component
public class MyBeanFactoryPostProcessor implements BeanFactoryPostProcessor {
    
    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory configurableListableBeanFactory) throws BeansException {
        DefaultListableBeanFactory defaultListableBeanFactory = (DefaultListableBeanFactory) configurableListableBeanFactory;
        BeanDefinitionBuilder beanDefinitionBuilder = BeanDefinitionBuilder.genericBeanDefinition(User.class);
        beanDefinitionBuilder.addPropertyValue("id", 123);
        beanDefinitionBuilder.addPropertyValue("name", "苏三说技术");
        defaultListableBeanFactory.registerBeanDefinition("user", beanDefinitionBuilder.getBeanDefinition());
    }
}
```

### 初始化 Bean 前后
在 Spring 中，提供了 BeanPostProcess 接口，可以在 Bean 的初始化前后执行一些指定的逻辑：
```java
public interface BeanPostProcessor {
	@Nullable
	default Object postProcessBeforeInitialization(Object bean, String beanName) throws BeansException {
		return bean;
	}

	@Nullable
	default Object postProcessAfterInitialization(Object bean, String beanName) throws BeansException {
		return bean;
	}
}
```

### 初始化方法
在 Spring 中提供了比较多初始化 Bean 的方法：

- 使用 @PostProcessor 接口
- 实现 InitializeBean 接口

### 关闭容器前
在 Spring 容器关闭时，我们可以执行一些特定的操作：关闭资源文件等，这时我们只需要实现 DisposableBean 接口即可：
```java
@Service
public class DService implements InitializingBean, DisposableBean {
 
    @Override
    public void destroy() throws Exception {
        System.out.println("DisposableBean destroy");
    }
 
    @Override
    public void afterPropertiesSet() throws Exception {
        System.out.println("InitializingBean afterPropertiesSet");
    }
}
```
