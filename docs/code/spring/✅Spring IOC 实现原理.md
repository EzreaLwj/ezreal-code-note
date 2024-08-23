## 一、什么是 IOC 
IOC 是控制反转的意思，原来对象的控制权在我们手中，我们自己手动 new 对象，而现在对象的控制权交给了 Spring 容器，容器复杂控制和创建对象，并在需要的时候将它们注入到控制程序中。

使用 IOC 的好处：

1. **使用者不用关心 Bean 的使用细节**，如 B b = new B(c,d,e,f); 如果要使用 B，就要把 c，d，e，f 全部都感知一遍，这显然是非常麻烦且不合理的。
2. **不用创建多个相同的 Bean 导致浪费**
```java
B b = new B();
B a = new B();
```
如果b，a都引用了对象 B，那么 b 和 a 就有可能创建出两个不同的对象实例，实际上，我们只需要一个就好了。

3. **Bean 的修改使用方无需感知**，如果我们要对 Bean B 进行修改，那么所有使用到 Bean B 的地方都要修改一遍。如果我们使用了 IOC 容器，其他的 Bean 就无需感知该 Bean 的修改状态。

## 二、IOC 实现原理
### 2.1 配置读取
在我们创建 BeanFactory 时，我们会通过 XmlBeanDefinitionReader 类的 loadBeanDefinitions 方法，将 spring.xml 文件中配置的 Bean 信息和通过 Component 等注解标注的类信息，封装成一个个 BeanDefinition，<br />BeanDefinition 中包含 Bean 的类对象，字段信息，scope 作用域信息等，然后将这些 BeanDefinition 填入到 BeanDefinitionMap 中，以我们配置的 id 或者 name 为 key，BeanDefinition 为 value。
```java
public class XmlBeanDefinitionReader extends AbstractBeanDefinitionReader {

    public XmlBeanDefinitionReader(BeanDefinitionRegistry registry) {
        super(registry);
    }

    public XmlBeanDefinitionReader(BeanDefinitionRegistry registry, ResourceLoader resourceLoader) {
        super(registry, resourceLoader);
    }

    protected void doLoadBeanDefinitions(InputStream inputStream) throws ClassNotFoundException, DocumentException {
        SAXReader reader = new SAXReader();
        Document document = reader.read(inputStream);
        Element rootElement = document.getRootElement();


        Element element = rootElement.element("component-scan");
        if (element != null) {
            String scanPath = element.attributeValue("base-package");
            if (StrUtil.isEmpty(scanPath)) {
                throw new BeansException("The value of base-package attribute can not be empty or null");
            }
            scanPackage(scanPath);
        }

        List<Element> beanList = rootElement.elements("bean");
        for (Element bean : beanList) {

            String id = bean.attributeValue("id");
            String name = bean.attributeValue("name");
            String className = bean.attributeValue("class");
            String initMethod = bean.attributeValue("init-method");
            String destroyMethodName = bean.attributeValue("destroy-method");
            String beanScope = bean.attributeValue("scope");

            // 获取 Class，方便获取类中的名称
            Class<?> clazz = Class.forName(className);
            // 优先级 id > name
            String beanName = StrUtil.isNotEmpty(id) ? id : name;
            if (StrUtil.isEmpty(beanName)) {
                beanName = StrUtil.lowerFirst(clazz.getSimpleName());
            }

            // 定义Bean
            BeanDefinition beanDefinition = new BeanDefinition(clazz);
            beanDefinition.setInitMethodName(initMethod);
            beanDefinition.setDestroyMethodName(destroyMethodName);

            if (StrUtil.isNotEmpty(beanScope)) {
                beanDefinition.setScope(beanScope);
            }

            List<Element> propertyList = bean.elements("property");
            // 读取属性并填充
            for (Element property : propertyList) {
                // 解析标签：property
                String attrName = property.attributeValue("name");
                String attrValue = property.attributeValue("value");
                String attrRef = property.attributeValue("ref");
                // 获取属性值：引入对象、值对象
                Object value = StrUtil.isNotEmpty(attrRef) ? new BeanReference(attrRef) : attrValue;
                // 创建属性信息
                PropertyValue propertyValue = new PropertyValue(attrName, value);
                beanDefinition.getPropertyValues().addPropertyValue(propertyValue);
            }
            if (getRegistry().containsBeanDefinition(beanName)) {
                throw new BeansException("Duplicate beanName[" + beanName + "] is not allowed");
            }
            // 注册 BeanDefinition
            getRegistry().registerBeanDefinition(beanName, beanDefinition);
        }


    }
}
```
### 2.2 Bean 的创建流程
配置填充完后，当 Spring 调用 createBean 方法时，就会进入 Bean 的实例化、初始化、注册销毁方法的三个阶段。<br />![](https://cdn.nlark.com/yuque/0/2023/png/27416797/1685966953859-594c3020-cbd4-4b90-9288-fd54bab2a26d.png?x-oss-process=image%2Fformat%2Cwebp#averageHue=%23fbfbfb&from=url&id=OeqZK&originHeight=811&originWidth=976&originalType=binary&ratio=1.25&rotation=0&showTitle=false&status=done&style=none&title=)

首先，它会根据 beanName 获取对应的 BeanDefinition 对象，获取对应的 Class 类对象，进行反射调用创建 Bean 对象，完成 Bean 的实例化。

接着，一个实例化完后的 Bean 就会进行初始化操作，依次进行**依赖注入**（通过注解形式和配置文件的形式），执行 Aware 接口实现的方法，调用 BeanPostProcess 的 Before 方法，调用 InitializingBean 接口实现的 afterPropertiesSet 方法，调用 initMethod 方法，最后执行 BeanPostProcess 的 After 方法，最后完成 Bean 的初始化操作，最后根据 scope 作用域决定是否存入到单例池（一级缓存）并返回。

当调用 BeanFactory 的 getBean 方法时，它先会去 SingletonMap 中尝试获取该 Bean，如果不存在就进行 createBean 操作。<br />代码如下：
```java
protected Object createBean(String beanName, BeanDefinition beanDefinition, Object... args) throws BeansException {

	Object bean = null;
	try {

		bean = resolveBeforeInstantiation(beanName, beanDefinition);
		if (bean != null) {
			return bean;
		}
		// bean 的实例化
		bean = createInstance(beanName, beanDefinition, args);

		// 加入一级缓存
		if (beanDefinition.isSingleton()) {
			Object finalBean = bean;
			addSingletonFactory(beanName, () -> getEarlyBeanReference(beanName, beanDefinition, finalBean));
		}

		// 在设置 Bean 属性之前，允许 BeanPostProcessor 修改属性值
		// 通过注解依赖注入
		applyBeanPostProcessorsBeforeApplyingPropertyValues(beanName, bean, beanDefinition);

		// 通过配置文件的依赖注入
		applyPropertyValues(beanName, bean, beanDefinition);

		// 执行初始化方法
		bean = initializeBean(beanName, bean, beanDefinition);

	} catch (Exception e) {
		throw new BeansException("Instantiation of bean failed", e);
	}

	registerDisposableBeanIfNecessary(beanName, bean, beanDefinition);

	Object exposeObject = bean;
	if (beanDefinition.isSingleton()) {

		// 从二级缓存中获取对象
		exposeObject = getSingleton(beanName);
		registerSingleton(beanName, exposeObject);
	}

	return exposeObject;
}


/**
 * 执行初始化方法
 *
 * @param beanName       bean名称
 * @param bean           bean对象
 * @param beanDefinition bean定义
 * @return 结果
 */
private Object initializeBean(String beanName, Object bean, BeanDefinition beanDefinition) {

	// invokeAwareMethods
	if (bean instanceof Aware) {
		if (bean instanceof BeanFactoryAware) {
			((BeanFactoryAware) bean).setBeanFactory(this);
		}
		if (bean instanceof BeanClassLoaderAware) {
			((BeanClassLoaderAware) bean).setBeanClassLoader(getBeanClassLoader());
		}
		if (bean instanceof BeanNameAware) {
			((BeanNameAware) bean).setBeanName(beanName);
		}
	}
	
	// 前置处理器
	Object wrappedBean = applyBeanPostProcessorsBeforeInitialization(bean, beanName);

	try {
		// 执行初始化方法
		invokeInitialMethod(beanName, wrappedBean, beanDefinition);
	} catch (Exception e) {
		throw new RuntimeException(e);
	}

	// 后置处理器
	return applyBeanPostProcessorsAfterInitialization(bean, beanName);
}

/**
 * 执行初始化方法
 *
 * @param beanName       bean名称
 * @param wrappedBean    包装的bean
 * @param beanDefinition bean定义
 */
private void invokeInitialMethod(String beanName, Object wrappedBean, BeanDefinition beanDefinition) throws Exception {

	if (wrappedBean instanceof InitializingBean) {
		InitializingBean bean = (InitializingBean) wrappedBean;
		bean.afterPropertiesSet();
	}

	String initMethodName = beanDefinition.getInitMethodName();
	if (StrUtil.isNotEmpty(initMethodName)) {
		Method method = wrappedBean.getClass().getMethod(initMethodName);
		method.invoke(wrappedBean);
	}
}

```
## 三、ApplicationContext 创建流程
ApplicationContext 中包含了 BeanFactory，并且提供了一些更高级的特性。它有一个实现类是 ClassPathXmlApplicationContext，调用了父类 AbstractApplicationContext 中 refresh 方法，完成 Context 容器的初始化。

```java
public class ClassPathXmlApplicationContext extends AbstractXmlApplicationContext{

    private String[] configurations;

    public ClassPathXmlApplicationContext() {
    }

    public ClassPathXmlApplicationContext(String configuration) {
        this(new String[]{configuration});
    }

    public ClassPathXmlApplicationContext(String[] configurations) {
        this.configurations = configurations;
		//在构造器中调用父类的refresh方法
        refresh();
    }

    @Override
    protected String[] getConfigurations() {
        return configurations;
    }

}

```
```java
@Override
public void refresh() throws BeansException {

	//1. 创建BeanFactory
	refreshBeanFactory();

	//2. 获取bean工厂
	ConfigurableListableBeanFactory beanFactory = getBeanFactory();

	//3. 提前加入ApplicationContextAwareProcessor,因为在注册后处理器时无法统一注入ApplicationContext
	beanFactory.addBeanPostProcessor(new ApplicationContextAwareProcessor(this));

	//4. 执行后工厂处理器
	invokeBeanFactoryPostProcessors(beanFactory);

	//5. 注册后处理器
	registerBeanPostProcessors(beanFactory);

	//6. 提前创建所有单例对象
	beanFactory.preInstantiateSingletons();

	// 初始化事件发布者
	initApplicationEventMulticaster();
	
	// 7. 注册事件监听器
	registerListeners();

	// 9. 发布容器刷新完成事件
	finishRefresh();

}

```

- 调用 refreshBeanFactory 方法时，就会调用 XmlBeanDefinitionReader 类来读取配置信息，封装一个个 BeanDefinition 到 BeanDefinitionMap 中；
- 而 preInstantiateSingletons 方法就是创建单例对象，循环调用 getBean 方法来创建 Bean 对象，提前放入到单例池中；

