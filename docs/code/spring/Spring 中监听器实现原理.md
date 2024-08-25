在 ApplicationContext 实现了一个 ApplicationEventPublisher 接口
```java
public interface ApplicationEventPublisher {

    void publishEvent(ApplicationEvent event);

}
```

- 该接口定义了事件的发布方法

同时 ApplicationContext 类内部聚合了一个事件广播器 ApplicationEventMulticaster
```java
public abstract class AbstractApplicationContext extends DefaultResourceLoader implements ConfigurableApplicationContext {

    /**
     * 事件发布器
     */
    private ApplicationEventMulticaster applicationEventMulticaster;

	@Override
    public void publishEvent(ApplicationEvent event) {
        applicationEventMulticaster.multicastEvent(event);
    }
	
}
```

- 事件发布器的作用就是**根据事件找到对应的 Listener**；
- 所以，当我们想要触发事件时，只需要引入 ApplicationContext（可以通过 Aware 接口引入），调用 publishEvent 方法即可；


ApplicationEventMulticaster 的作用就是根据对应的事件找到对应的 Listener
```java
public class SimpleApplicationEventMulticaster extends AbstractApplicationEventMulticaster{

    public SimpleApplicationEventMulticaster(BeanFactory beanFactory) {
        setBeanFactory(beanFactory);
    }

    @Override
    public void multicastEvent(ApplicationEvent applicationEvent) {
		//获取所有适配的监听器
        Collection<ApplicationListener> applicationListeners = getApplicationListeners(applicationEvent);
		// 调用每一个监听器的onApplicationonEvent方法
        for (ApplicationListener listener : applicationListeners) {
            listener.onApplicationEvent(applicationEvent);
        }
    }
}

```

具体获取 Listener 的方法则在抽象类 AbstractApplicationEventMulticaster 中
```java
public abstract class AbstractApplicationEventMulticaster implements ApplicationEventMulticaster, BeanFactoryAware {

    private BeanFactory beanFactory;

    private LinkedHashSet<ApplicationListener<ApplicationEvent>> applicationListeners = new LinkedHashSet<>();

    @Override
    public void addApplicationListener(ApplicationListener<?> applicationListener) {
        applicationListeners.add((ApplicationListener<ApplicationEvent>)applicationListener);
    }

    @Override
    public void removeApplicationListener(ApplicationListener<?> applicationListener) {
        applicationListeners.remove((ApplicationListener<ApplicationEvent>)applicationListener);
    }

    protected Collection<ApplicationListener> getApplicationListeners(ApplicationEvent applicationEvent) {
        LinkedList<ApplicationListener> listeners = new LinkedList<>();

        for (ApplicationListener applicationListener : applicationListeners) {
            if (supportEvent(applicationEvent, applicationListener)) {
                listeners.add(applicationListener);
            }
        }
        return listeners;
    }

	private boolean supportEvent(ApplicationEvent applicationEvent, ApplicationListener<ApplicationEvent> applicationListener) {
		Class<?> aClass = applicationListener.getClass();
		Class<?> targetClass = ClassUtil.isCglibProxyClass(aClass) ? aClass.getSuperclass() : aClass;
	
		Type genericInterface = targetClass.getGenericInterfaces()[0];
	
		Type actualTypeArgument = ((ParameterizedType) genericInterface).getActualTypeArguments()[0];
	
		// 获取泛型类的名称
		String typeName = actualTypeArgument.getTypeName();
		Class<?> typeClass = null;
	
		try {
		   typeClass = Class.forName(typeName);
		} catch (ClassNotFoundException e) {
			e.printStackTrace();
		}
	
		return typeClass.isAssignableFrom(applicationEvent.getClass());
    }
}
```

- 关键是在 supportEvent 方法，它获取 Listener 中的泛型类，然后根据事件的类型与泛型类进行比较，如果是同一个类或者是子类和父类的关系，那么该事件就适配该 Listener


我们再来看看 Listener 是怎样定义的
```java
public interface ApplicationListener<E extends ApplicationEvent> extends EventListener {

    /**
     * 处理对应的事件
     * @param event the event to respond to
     */
    void onApplicationEvent(E event);
}

```

- 这是一个 Linstener 接口，可见它需要一个泛型类，该泛型类还需要是 ApplicationEvent 的子类；

