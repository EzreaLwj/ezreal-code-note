
# Spring 循环依赖与三级缓存 
## 一、什么是循环依赖

Spring 循环依赖是指：两个不同的 Bean 对象，相互成为各自的字段，当这两个 Bean 中的其中一个 Bean 进行依赖注入时，会陷入死循环，即循环依赖现象。

![](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240317212449299.png#id=oW5vh&originHeight=407&originWidth=1026&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&title=)

代码例子：

```java
@Component
public class UserServiceA {
    @Autowire
    private UserServiceB userServiceB;
}

@Component
public class UserServiceB {
    @Autowire
    private UserServiceA userServiceA;
}
```

- UserServiceA 与 UserServiceB 之间相互依赖

## 二、三级缓存解决循环依赖

### 2.1 三级缓存

针对循环依赖的现象，Spring 中使用提供了**三级缓存**解决循环的问题，我们先看 Spring 中使用到三级缓存的代码：

```java
public class DefaultSingletonBeanRegistry implements SingletonBeanRegistry {

    /**
     * 一级缓存
     */
    private Map<String, Object> singletonObjects = new ConcurrentHashMap<>();

    /**
     * 二级缓存
     */
    private Map<String, Object> earlySingletonObjects = new ConcurrentHashMap<>();

    /**
     * 三级缓存
     */
    private Map<String, ObjectFactory<?>> singletonFactory = new HashMap<>();

	@Nullable
	protected Object getSingleton(String beanName, boolean allowEarlyReference) {
		// Quick check for existing instance without full singleton lock
		Object singletonObject = this.singletonObjects.get(beanName);
		if (singletonObject == null && isSingletonCurrentlyInCreation(beanName)) {
			singletonObject = this.earlySingletonObjects.get(beanName);
			if (singletonObject == null && allowEarlyReference) {
				synchronized (this.singletonObjects) {
					// Consistent creation of early reference within full singleton lock
					singletonObject = this.singletonObjects.get(beanName);
					if (singletonObject == null) {
						singletonObject = this.earlySingletonObjects.get(beanName);
						if (singletonObject == null) {
							ObjectFactory<?> singletonFactory = this.singletonFactories.get(beanName);
							if (singletonFactory != null) {
								singletonObject = singletonFactory.getObject();
								this.earlySingletonObjects.put(beanName, singletonObject);
								this.singletonFactories.remove(beanName);
							}
						}
					}
				}
			}
		}
		return singletonObject;
	}
}
```

- **SingletonObjects**：**一级缓存**，存储完整的 Bean；
- **EarlySingletonObjects**：**二级缓存**，存储从第三级缓存中创建出代理对象的 Bean，即半成品的 Bean；
- **SingletonFactory**：**三级缓存**，存储实例化完后，包装在 FactoryBean 中的工厂 Bean；

在上面的 getSingleton 方法中，先从 SingletonObjects 中获取完整的 Bean，如果获取失败，就从 EarlySingletonObjects 中获取半成品的 Bean，如果 EarlySingletonObjects 中也没有获取到，那么就从 SingletonFactory 中，通过 FactoryBean 的 getBean 方法，获取提前创建 Bean。如果 SingletonFactory 中也没有获取到，就去执行创建 Bean 的方法。

### 2.2 解决循环依赖

Spring 产生一个完整的 Bean 可以看作三个阶段：

- **createBean**：实例化 Bean；
- **populateBean**：对 Bean 进行依赖注入；
- **initializeBean**：执行 Bean 的初始化方法；

**产生循环依赖的根本原因是**：对于一个实例化后的 Bean，当它进行依赖注入时，会去创建它所依赖的 Bean，**但此时它本身没有缓存起来**，如果其他的 Bean 也依赖于它自己，那么就会创建新的 Bean，陷入了循环依赖的问题。

所以，三级缓存解决循环依赖的根本途径是：当 Bean **实例化**后，**先将自己存起来**，如果其他 Bean 用到自己，就先从缓存中拿，不用去创建新的 Bean 了，也就不会产生循环依赖的问题了。过程如下图所示：

![](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/1710685475951-3e01450a-7309-4fe3-b32f-e117f202e90a.png#id=nm5tj&originHeight=4388&originWidth=3232&originalType=binary&ratio=1&rotation=0&showTitle=false&status=done&style=none&title=)

- 在 Spring 源码中，调用完 createInstance 方法后，然后就把当前 Bean 加入到 SingletonFactory 中，也就是在实例化完毕后，就加入到三级缓存中；

### 2.3 为什么需要三级缓存？一层和两层可以吗？

#### 2.3.1 一级缓存失效的原因

**对于只使用一级缓存的情况，是不能够解决循环依赖的**，有下面两个原因：

1.  **如果只使用一级缓存**，在创建 Bean 的过程中，我们会在**初始化完毕**（注意是初始化，如果只有一级缓存，该缓存需要存储完整的 Bean）后把 Bean 放入到缓存中。此时依然会产生循环依赖问题，因为依赖注入的过程是在初始化之前的，依赖注入时是从缓存中获取不了对应的 Bean，从而再次引起循环依赖问题。 
2.  那如果我们提前在 Bean 实例化后就放入到缓存呢？答案也是不行的。因为我们没有考虑到**代理对象（Spring AOP）**，如果我们创建的 Bean 是代理对象，就要在实例化后就要创建出来，那么就会带来新的问题：JDK Proxy 代理对象实现的是目标类的接口，在进行依赖注入时会找不到对应的属性和方法而报错（也就是说，**提前创建出来的代理对象是没有原来对象的属性和方法的**）。 

> Spring AOP 是依赖于 AnnotationAwareAspectJAutoProxyCreator 的，这是一个后置处理器，在 Bean 实例化完毕后在初始化方法中才执行的。


#### 2.3.2 不使用二级缓存的原因

先说结论，使用二级缓存是可以的。

对于普通对象来说，使用二级缓存是可以解决循环依赖的。在实例化后把对象存入第一级缓存中，如果其他对象依赖注入该对象，就从第一级缓存中拿就行了。对象初始化完毕后，再写入到第二级缓存中即可。

但是对于代理对象来说，就显得十分麻烦了。如果循环依赖注入的对象是代理对象，我们就需要在对象实例化后**提前把代理对象创建出来**，即提前创建出所有的代理对象。但是在**目前 Spring AOP 的设计**来说，**代理对象的创建是在初始化方法**中的 `AnnotationAwareAspectJAutoProxyCreator` **后置处理器创建的**。这与 Spring AOP 的代理设计原则是相违背的。

所以，Spring 就再引用了一层缓存 SingletonFactory，存储着 FactoryBean，我们来看看代码：

```java
if (beanDefinition.isSingleton()) {
    Object finalBean = bean;
    //加入FactoryBean
    addSingletonFactory(beanName, () -> getEarlyBeanReference(beanName, beanDefinition, finalBean));
}
```

当我们调用这个 FactoryBean 的 getBean 方法时：

```java
protected Object getEarlyBeanReference(String beanName, BeanDefinition beanDefinition, Object bean) {

    Object exposedObject = bean;
    List<BeanPostProcessor> beanPostProcessors = getBeanPostProcessors();
    for (BeanPostProcessor beanPostProcessor : beanPostProcessors) {
        if (beanPostProcessor instanceof InstantiationAwareBeanPostProcessor) {
            exposedObject = ((InstantiationAwareBeanPostProcessor) beanPostProcessor).getEarlyBeanReference(bean, beanName);
            if (exposedObject == null) {
                return exposedObject;
            }
        }
    }
    return exposedObject;
}

// AnnotationAwareAspectJAutoProxyCreator
@Override
public Object getEarlyBeanReference(Object bean, String beanName) {
    earlyProxyReferences.add(bean);
    return wrapIfNecessary(bean,beanName);
}
```

发现它其实通过 InstantiationAwareBeanPostProcessor 接口的 getEarlyBeanReference 来**创建代理对象**。**所以对于代理对象来说，Spring 没有直接提前创建，而是在它产生循环依赖时，再通过 getEarlyBeanReference 方法来创建代理对象的。**

## 三、循环依赖被完全解决了吗

### 3.1 循环依赖只支持单例对象

对于 scope 为 property 的 Bean，三级缓存是没有解决循环依赖的。因为它们的作用域是原型，每次使用到时都会创建一个新对象，**不进缓存！**

```java
    @Override
    protected Object createBean(String beanName, BeanDefinition beanDefinition, Object... args) throws BeansException {

    Object bean = null;
    try {
        // 加入一级缓存
        if (beanDefinition.isSingleton()) {
            Object finalBean = bean;
            addSingletonFactory(beanName, () -> getEarlyBeanReference(beanName, beanDefinition, finalBean));
        }

    } catch (Exception e) {
        throw new BeansException("Instantiation of bean failed", e);
    }

    Object exposeObject = bean;
    if (beanDefinition.isSingleton()) {

        // 从二级缓存中获取对象
        exposeObject = getSingleton(beanName);
        registerSingleton(beanName, exposeObject);
    }
    return exposeObject;
}
```

- 可见，在加入缓存时，都会判断当前的 Bean 是不是 Singleton 的，如果不是就不加入到缓存中。

### 3.2 通过构造器注入的类无法解决循环依赖

```java
@Component
public class BeanB {
    private BeanA a;
    public BeanB(BeanA a) {
        this.a = a;
    }
}

@Component
public class BeanA {
    private BeanB b;
    public BeanA(BeanB b) {
        this.b = b;
    }
}
```

上述代码中，我们通过构造器来注入 BeanA 和 Bean B，Spring 是无法解决它们循环依赖的问题的。

因为在调用 BeanA 的构造器方法时 BeanA 是没有实例化完成的，缓存中不存在 BeanA 对象，此时就要注入 BeanB 对象，毫无疑问的会产生循环依赖的问题。

但是，对于这种情况来说，我们可以通过 [@Lazy ](/Lazy ) 注解来延迟 BeanB 的加载。即调用构造器方法时先不创建 BeanB 对象，当使用到BeanB 对象时才继续创建，此时 BeanB 也已经创建完成了，就不会产生循环依赖的问题了。 

```java
@Component
public class BeanA {
    private BeanB b;
    public BeanA(@Lazy BeanB b) {
        this.b = b;
    }
}
```
