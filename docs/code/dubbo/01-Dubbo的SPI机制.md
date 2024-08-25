# Dubbo的SPI机制



## 一、背景

Dubbo 源码设计中大量使用了 SPI 的设计思想，要想深入理解 Dubbo 源码，必须对 SPI 的设计思想有充分了解。Dubbo 借鉴了 Java SPI，自己实现了一套 Dubbo SPI。



## 二、Java SPI 机制



### 2.1 定义

Java SPI 全称是 Java Service Provider Interface，是 Java 提供的**服务提供者发现机制**。其核心功能就是通过接口找到对应的实现类。在实际运用中，主要用于程序启动或运行时，通过 SPI 机制，加载并装配接口实现类，实现组件的替换和动态扩展。

这里有两个关键点：实现类的加载和装配。

> 使用 SPI 的前提是**面向接口编程**，即所有的依赖都是依赖接口，而非具体的实现类，且所有用到这个接口的地方都可以替换为实现类。请参考设计原则里的**依赖倒置原则（DIO）**和**里氏替换原则（LSP）**。 **Java SPI 正是通过在运行时替换实现类，来实现接口与实现的解耦，从而实现模块与模块的解耦。**



### 2.2 SPI 机制举例：数据库驱动

我们在使用 MySQL 或者 Oracle 数据库时，只需要引入 MySQL 驱动 jar 或者 Oracle 驱动 jar 包就可以了，它使用到了 DriverManager：

1. DriverManager 通过 **SPI 机制**加载不同厂商的驱动；
2. DriverManager 使用厂商的驱动获取连接；

```java
//DriverManager使用SPI加载Driver扩展实现，如com.mysql.jdbc.Driver
ServiceLoader<Driver> loadedDrivers = ServiceLoader.load(Driver.class);
Iterator<Driver> driversIterator = loadedDrivers.iterator();
```

- 这里的 `ServiceLoader.load(Driver.class)` 实现了对 Driver 的加载。



在 java-connect-mysql 依赖的 jar 包中，在其 \META-INF\services\java.sql.Driver 文件中：

```tex
com.mysql.cj.jdbc.Driver
```

- 其中文件名称是接口的路径名，而文件中的内容是接口的具体实现；
- 当调用 ServiceLoader 的 load 方法时，读取该文件中的实现类，进行类的加载和实例化；



这样做的好处有：

1. JDK 的数据库连接操作和驱动的实现彻底解耦；
2. 使用方不用加载所有的数据库驱动，只需要加载自己关心的数据库驱动；
3. 使用方几乎不需要任何配置，就可以切换数据库驱动；



## 三、Dubbo SPI 机制



### 3.1 Dubbo SPI 的基本使用方法

1. 在 **META-INF/dubbo** 下创建一个接口全限定名的文件；
2. 接口全限定名文件中以键值对的形式填写实现类；
3. 接口添加 @SPI 注解；
4. 使用 ExtensionLoader.getExtensionLoader(class) 获取 ExtensionLoader 对象；
5. 使用 ExtensionLoader.getExtension(key) 获取接口实现类对象。



Dubbo SPI 与 Java SPI 的区别：

1. Java SPI 一次性实例化所有扩展点的实现，而 Dubbo SPI 可以指定加载某个扩展点；
2. Java SPI 不支持依赖注入，对扩展点的依赖不友好。**Dubbo SPI 支持依赖注入**，即在实例化扩展点的过程中，通过反射调用扩展点的 setXXX 方法，注入依赖的扩展点；

3. Java SPI 获取实现类方式单一，只能通过遍历获取。**Dubbo SPI 支持通过 key 获取实现类**，使用起来更方便、更灵活；
4. 另外，Dubbo SPI 还实现了强大的自适应扩展和自动激活功能，通过这两个功能可以实现在运行时替换具体实现类（运行到具体的方法时才决定使用哪个实现）以及简化配置。



### 3.2 Dubbo SPI 获取扩展点的实现原理

Dubbo SPI 最常用、最基本的用法就是获取扩展点，同时也是自适应扩展点、激活扩展点等其他功能的基础：

1. 解析扩展点配置文件；
2. 加载扩展点实现类；
3. 实例化扩展点；
4. 依赖注入；
5. 如果是包装类，则特殊处理并返回包装类；

面从入口方法`getExtension(String name)`开始分析：

```java
public T getExtension(String name, boolean wrap) {
    checkDestroyed();
    if (StringUtils.isEmpty(name)) {
        throw new IllegalArgumentException("Extension name == null");
    }
    if ("true".equals(name)) {
        return getDefaultExtension();
    }
    String cacheKey = name;
    if (!wrap) {
        cacheKey += "_origin";
    }
    //从缓存中获取扩展点
    final Holder<Object> holder = getOrCreateHolder(cacheKey);
    Object instance = holder.get();
    if (instance == null) {
        synchronized (holder) {
            instance = holder.get();
            if (instance == null) {
                //创建扩展点
                instance = createExtension(name, wrap);
                holder.set(instance);
            }
        }
    }
    return (T) instance;
}
```

这个方法有两个地方需要注意：

- `getOrCreateHolder`:在获取扩展点的时候，会先从`cachedInstances`中获取扩展点`Holder`，如果有就直接返回了，没有就创建一个新的`Holder`，并涉及下面的关键逻辑`createExtension(name)`；
- `createExtension(name)`：是创建扩展点的关键逻辑，核心代码都在里面；



下面看创建扩展点的核心方法`createExtension(name)`：

```java
private T createExtension(String name, boolean wrap) {
    
    //此处的getExtensionClasses()是关键，包含了解析配置文件、加载类等逻辑。
    Class<?> clazz = getExtensionClasses().get(name);
    if (clazz == null || unacceptableExceptions.contains(name)) {
        throw findException(name);
    }
    try {
        //先从全局扩展点容器EXTENSION_INSTANCES里获取，如果没有就创建个新的
        T instance = (T) extensionInstances.get(clazz);
        if (instance == null) {
            // 创建实例对象
            extensionInstances.putIfAbsent(clazz, createExtensionInstance(clazz));
            instance = (T) extensionInstances.get(clazz);
            instance = postProcessBeforeInitialization(instance, name);
            // 依赖注入
            injectExtension(instance);
            instance = postProcessAfterInitialization(instance, name);
        }
		// 判断是否是包装类
        if (wrap) {
            List<Class<?>> wrapperClassesList = new ArrayList<>();
            if (cachedWrapperClasses != null) {
                wrapperClassesList.addAll(cachedWrapperClasses);
                wrapperClassesList.sort(WrapperComparator.COMPARATOR);
                Collections.reverse(wrapperClassesList);
            }
			// 对包装类进行依赖注入
            if (CollectionUtils.isNotEmpty(wrapperClassesList)) {
                for (Class<?> wrapperClass : wrapperClassesList) {
                    Wrapper wrapper = wrapperClass.getAnnotation(Wrapper.class);
                    boolean match = (wrapper == null) ||
                        ((ArrayUtils.isEmpty(wrapper.matches()) || ArrayUtils.contains(wrapper.matches(), name)) &&
                            !ArrayUtils.contains(wrapper.mismatches(), name));
                    if (match) {
                        instance = injectExtension((T) wrapperClass.getConstructor(type).newInstance(instance));
                        instance = postProcessAfterInitialization(instance, name);
                    }
                }
            }
        }

        // Warning: After an instance of Lifecycle is wrapped by cachedWrapperClasses, it may not still be Lifecycle instance, this application may not invoke the lifecycle.initialize hook.
        initExtension(instance);
        return instance;
    } catch (Throwable t) {
        throw new IllegalStateException("Extension instance (name: " + name + ", class: " +
            type + ") couldn't be instantiated: " + t.getMessage(), t);
    }
}
```

1. 加载扩展点 Class，核心代码在`getExtensionClasses()`。它包含了解析配置文件、加载类等逻辑，要认真的跟下去；
2. 依赖注入，核心代码在`injectExtension(instance)`。这个点在后面单独详细的介绍；
3. 包装类的处理，核心代码在`cachedWrapperClasses`。所谓包装类，就是对原类的增强类，类名为`XXXWrapper`，且有一个`XXXWrapper(XXX)`的构造函数，如`ProtocolFilterWrapper`，介绍说明都在代码注释里。 



下面主要看`getExtensionClasses()`：

```java
private Map<String, Class<?>> getExtensionClasses() {
     //cachedClasses是扩展点名-扩展点Class的Map容器的Holder
    Map<String, Class<?>> classes = cachedClasses.get();
     //同步处理，防止重复加载扩展点Class
    if (classes == null) {
        synchronized (cachedClasses) {
            classes = cachedClasses.get();
            if (classes == null) {
                try {
                    //加载扩展点Class，关键代码，要认真跟下去
                    classes = loadExtensionClasses();
                } catch (InterruptedException e) {
                    logger.error(COMMON_ERROR_LOAD_EXTENSION, "", "", "Exception occurred when loading extension class (interface: " + type + ")", e);
                    throw new IllegalStateException("Exception occurred when loading extension class (interface: " + type + ")", e);
                }
                cachedClasses.set(classes);
            }
        }
    }
    return classes;
}

```

- 首先，从`cachedClasses`里获取已加载的 Class。

- 然后，如果有直接返回，如果没有就加载扩展点 Class。

```java
private Map<String, Class<?>> loadExtensionClasses() throws InterruptedException {
    checkDestroyed();
    cacheDefaultExtensionName();

    Map<String, Class<?>> extensionClasses = new HashMap<>();
	// LoadingStrategy是指加载策略，可以从1、META-INF/services/；2、META-INF/dubbo/；3、META-INF/dubbo/internal/ 中加载
    for (LoadingStrategy strategy : strategies) {
       // 执行加载类信息的方法
        loadDirectory(extensionClasses, strategy, type.getName());

        // compatible with old ExtensionFactory
        if (this.type == ExtensionInjector.class) {
            loadDirectory(extensionClasses, strategy, ExtensionFactory.class.getName());
        }
    }
    return extensionClasses;
}
```

`loadExtensionClasses()`有 2 个核心功能：

1. 获取默认扩展点名，里面的内容不多，这里只需要知道是通过`@SPI`注解获取的就行了；
2. 从配置目录里解析扩展点配置文件，并加载扩展点 Class 为`Map< 扩展点名,扩展点 Class>`，这里需要注意的是`META-INF/services/`、`META-INF/dubbo/`、`META-INF/dubbo/internal/`下的配置文件都会被加载进来。 下面是`loadDirectory中的loadResource`加载、解析配置文件和加载 Class 的逻辑：



```java
private void loadResource(Map<String, Class<?>> extensionClasses, ClassLoader classLoader,
                          java.net.URL resourceURL, boolean overridden, String[] includedPackages, String[] excludedPackages, String[] onlyExtensionClassLoaderPackages) {
    try {
        List<String> newContentList = getResourceContent(resourceURL);
        String clazz;
        for (String line : newContentList) {
            try {
                String name = null;
                int i = line.indexOf('=');
                if (i > 0) {
                    // 解析文件中的键值对
                    name = line.substring(0, i).trim();
                    clazz = line.substring(i + 1).trim();
                } else {
                    clazz = line;
                }
                if (StringUtils.isNotEmpty(clazz) && !isExcluded(clazz, excludedPackages) && isIncluded(clazz, includedPackages)
                    && !isExcludedByClassLoader(clazz, classLoader, onlyExtensionClassLoaderPackages)) {
                    //将解析好的内容放入到extensionClasses中，其中调用Class.forName方法来生成对应的class类
                    loadClass(extensionClasses, resourceURL, Class.forName(clazz, true, classLoader), name, overridden);
                }
            } catch (Throwable t) {
                IllegalStateException e = new IllegalStateException("Failed to load extension class (interface: " + type +
                    ", class line: " + line + ") in " + resourceURL + ", cause: " + t.getMessage(), t);
                exceptions.put(line, e);
            }
        }
    } catch (Throwable t) {
        logger.error(COMMON_ERROR_LOAD_EXTENSION, "", "", "Exception occurred when loading extension class (interface: " +
            type + ", class file: " + resourceURL + ") in " + resourceURL, t);
    }
}
```

- 获取所有配置文件路径，这里注意可能存在多个文件；
- 遍历每个文件，逐个解析：逐行读取文件，解析出 key 和 class，然后将解析出的 class 放入到 extensionClasses 中；



至此，Dubbo SPI 获取扩展点的源码就分析完了。



### 3.3 Dubbo SPI 自适应扩展点的实现原理

官网例子：https://cn.dubbo.apache.org/zh-cn/docsv2.7/dev/source/adaptive-extension/

Dubbo 框架在运行时，**直到扩展点方法被执行时**才决定调用哪一个扩展点实现。要做到这一点，所有的依赖就不能指定某个扩展点，而是要依赖一个代理，这个代理在运行时决定调用哪个扩展点。这个代理就是**自适应扩展点**。



以通讯协议为例大概是这样：



![image-20240717182722145](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240717182722145.png)

发送请求依赖的协议是自适应扩展点协议，它在运行时选择具体的协议，最后使用选中的协议。

Dubbo 实现自适应扩展点的原理如下：

- 定义了一个 @Adaptive 注解，可以标记在类上或者方法上，有此标记的都支持自适应扩展点，反之不支持；
- 通过`ExtensionLoader.getAdaptiveExtension()`获取自适应扩展点，在获取过程中，拼接自适应扩展点 Class 文件，然后编译成 Class 并实例化，得到自适应扩展点对象；
- 对自适应扩展点进行注入；



**标记支持自适应扩展点**

```java
@SPI(value = "dubbo", scope = ExtensionScope.FRAMEWORK)
public interface Protocol {

    int getDefaultPort();

    @Adaptive
    <T> Exporter<T> export(Invoker<T> invoker) throws RpcException;

    @Adaptive
    <T> Invoker<T> refer(Class<T> type, URL url) throws RpcException;

    void destroy();

    default List<ProtocolServer> getServers() {
        return Collections.emptyList();
    }
}
```



**获取自适应扩展点**

```java
Protocol protocol = ExtensionLoader.getExtensionLoader(Protocol.class).getAdaptiveExtension()
```



我们跟进去 getAdaptiveExtension 方法：

```java
@SuppressWarnings("unchecked")
public T getAdaptiveExtension() {
    checkDestroyed();
    // 尝试从缓存中获取对应的类方法
    Object instance = cachedAdaptiveInstance.get();
    if (instance == null) {
        if (createAdaptiveInstanceError != null) {
            throw new IllegalStateException("Failed to create adaptive instance: " +
                createAdaptiveInstanceError.toString(),
                createAdaptiveInstanceError);
        }

        synchronized (cachedAdaptiveInstance) {
            instance = cachedAdaptiveInstance.get();
            if (instance == null) {
                try {
                    //核心方法：createAdaptiveExtensionClass，创建自适应扩展点Class
                    instance = createAdaptiveExtension();
                    cachedAdaptiveInstance.set(instance);
                } catch (Throwable t) {
                    createAdaptiveInstanceError = t;
                    throw new IllegalStateException("Failed to create adaptive instance: " + t.toString(), t);
                }
            }
        }
    }

    return (T) instance;
}
```

- 其中 createAdaptiveExtension 是核心方法，包括：拼接 Class 字符串和 编译 Class 文件。



```java
private Class<?> createAdaptiveExtensionClass() {
    // Adaptive Classes' ClassLoader should be the same with Real SPI interface classes' ClassLoader
    ClassLoader classLoader = type.getClassLoader();
    try {
        if (NativeUtils.isNative()) {
            return classLoader.loadClass(type.getName() + "$Adaptive");
        }
    } catch (Throwable ignore) {

    }
    //生成Class字符串，里面通过拼接字符串实现。可以跟进去generate()看一看。
    String code = new AdaptiveClassCodeGenerator(type, cachedDefaultName).generate();
    org.apache.dubbo.common.compiler.Compiler compiler = extensionDirector.getExtensionLoader(
        org.apache.dubbo.common.compiler.Compiler.class).getAdaptiveExtension();
     //将Class字符串编译为Class，并返回
    return compiler.compile(type, code, classLoader);
}

```

- 拼接的 Class 字符串，就是我们编写的 java 文件的 Class 内容。



```java
public String generate(boolean sort) {
    // no need to generate adaptive class since there's no adaptive method found.
    if (!hasAdaptiveMethod()) {
        throw new IllegalStateException("No adaptive method exist on extension " + type.getName() + ", refuse to create the adaptive class!");
    }
	
    // 拼装文件信息
    StringBuilder code = new StringBuilder();
    code.append(generatePackageInfo()); //生成package
    code.append(generateImports()); //生成import内容
    code.append(generateClassDeclaration()); // 生成类声明

    Method[] methods = type.getMethods();
    if (sort) {
        Arrays.sort(methods, Comparator.comparing(Method::toString));
    }
    // 生成方法
    for (Method method : methods) {
        code.append(generateMethod(method));
    }
    code.append('}');

    if (logger.isDebugEnabled()) {
        logger.debug(code.toString());
    }
    return code.toString();
}
```

下面看生成好的 Protocol 自适应扩展点的 Class 内容：

```java
package org.apache.dubbo.rpc;
import org.apache.dubbo.common.extension.ExtensionLoader;
//类名=扩展点接口名$Adaptive
public class Protocol$Adaptive implements org.apache.dubbo.rpc.Protocol {
        //生成标记有@Adaptive的方法
	public org.apache.dubbo.rpc.Exporter export(org.apache.dubbo.rpc.Invoker arg0) throws org.apache.dubbo.rpc.RpcException {
		if (arg0 == null) throw new IllegalArgumentException("org.apache.dubbo.rpc.Invoker argument == null");
		if (arg0.getUrl() == null) throw new IllegalArgumentException("org.apache.dubbo.rpc.Invoker argument getUrl() == null");
		org.apache.dubbo.common.URL url = arg0.getUrl();
                //核心代码在这里，运行时解析url里的protocol参数
                //这里还有个默认值的处理，取的是Protocol接口@SPI注解里的value
		String extName = ( url.getProtocol() == null ? "dubbo" : url.getProtocol() );
		if(extName == null) throw new IllegalStateException("Failed to get extension (org.apache.dubbo.rpc.Protocol) name from url (" + url.toString() + ") use keys([protocol])");
                //根据protocol参数，选择指定的protocol扩展点
		org.apache.dubbo.rpc.Protocol extension = (org.apache.dubbo.rpc.Protocol)ExtensionLoader.getExtensionLoader(org.apache.dubbo.rpc.Protocol.class).getExtension(extName);
		return extension.export(arg0);
	}
        //没标记@Adaptive的方法，调用时直接抛异常
	public void destroy()  {
		throw new UnsupportedOperationException("The method public abstract void org.apache.dubbo.rpc.Protocol.destroy() of interface org.apache.dubbo.rpc.Protocol is not adaptive method!");
	}
        //没标记@Adaptive的方法，调用时直接抛异常
	public int getDefaultPort()  {
		throw new UnsupportedOperationException("The method public abstract int org.apache.dubbo.rpc.Protocol.getDefaultPort() of interface org.apache.dubbo.rpc.Protocol is not adaptive method!");
	}
        //生成标记有@Adaptive的方法
	public org.apache.dubbo.rpc.Invoker refer(java.lang.Class arg0, org.apache.dubbo.common.URL arg1) throws org.apache.dubbo.rpc.RpcException {
		if (arg1 == null) throw new IllegalArgumentException("url == null");
		org.apache.dubbo.common.URL url = arg1;
		String extName = ( url.getProtocol() == null ? "dubbo" : url.getProtocol() );
		if(extName == null) throw new IllegalStateException("Failed to get extension (org.apache.dubbo.rpc.Protocol) name from url (" + url.toString() + ") use keys([protocol])");
		org.apache.dubbo.rpc.Protocol extension = (org.apache.dubbo.rpc.Protocol)ExtensionLoader.getExtensionLoader(org.apache.dubbo.rpc.Protocol.class).getExtension(extName);
		return extension.refer(arg0, arg1);
	}
}

```



生成的自适应扩展点 Class 内容有以下特点：

- 类名=扩展点接口名 $Adaptive
- 带有`@Adaptive`标记的方法会生成方法内容
- 不带`@Adaptive`标记的方法，在调用时直接抛异常
- 自适应方法里的核心内容是：解析`URL`里的`protocol`参数，然后根据解析结果从`ExtensionLoader`获取指定的扩展点对象。 这样在依赖`Protocol`的地方都是依赖的`Protocol$Adaptive`，调用`export()`方法时是调用的`Protocol$Adaptive.export()`，然后就实现了运行时指定扩展点的目的。

至此，Dubbo SPI 扩展点的依赖注入源码就分析完了。



### 3.4 Dubbo SPI 扩展点的激活实现原理

参考文章：https://blog.csdn.net/nrsc272420199/article/details/107124949

上面说的都是单个接口的扩展点，还有一种场景，依赖的是扩展点集合（如：Filter）。这种场景下，会同时加载多个扩展点实现。此时，就可以用自动激活来简化配置。所谓激活，就是不需要手动配置，在程序运行时就能用的扩展点。比如`Protocol`需要配置指定协议（默认值除外，它是`@SPI`的另一个逻辑），而内置的很多`Filter`就不需要配置，如`TimeoutFilter`、`ExceptionFilter`等，**这些不需要配置、自动激活的扩展点就是扩展点的激活**。



激活扩展点的实现原理有 2 个关键点：

1. 定义`@Activate`注解，并给激活扩展点添加`@Activate`激活标记；
2. 在运行时调用`ExtensionLoader.getActivateExtension(URL, String, String)`获取激活扩展点。 `@Activate`注解只是一个标记，实现的核心逻辑是`ExtensionLoader.getActivateExtension(URL, String, String)`：

```java
public List<T> getActivateExtension(URL url, String key, String group) {
    //从URL参数里获取指定的扩展点
    String value = url.getParameter(key);
    //获取激活扩展点的核心方法，要认真跟下去
    return getActivateExtension(url, StringUtils.isEmpty(value) ? null : COMMA_SPLIT_PATTERN.split(value), group);
}
```



其中，这里的 getActivateExtension 方法：

```java
//ExtensionLoader.getActivateExtension()
public List<T> getActivateExtension(URL url, String[] values, String group) {
    //最终返回的结果
    List<T> exts = new ArrayList<>();
    //运行期间，URL参数中指定的扩展点
    List<String> names = values == null ? new ArrayList<>(0) : Arrays.asList(values);
    //处理默认的激活扩展点
    if (!names.contains(REMOVE_VALUE_PREFIX + DEFAULT_KEY)) {
        //解析配置文件、加载Class。过程中初始化了cachedActivates。
        //cachedActivates：存储了所有标记@Activate注解的扩展点
        getExtensionClasses();
        //遍历所有激活扩展点，筛选符合条件的激活扩展点
        for (Map.Entry<String, Object> entry : cachedActivates.entrySet()) {
            String name = entry.getKey();
            Object activate = entry.getValue();

            String[] activateGroup, activateValue;

            //只有标记的@Activate才符合基本筛选条件
            if (activate instanceof Activate) {
                activateGroup = ((Activate) activate).group();
                activateValue = ((Activate) activate).value();
            } else if (activate instanceof com.alibaba.dubbo.common.extension.Activate) {
                activateGroup = ((com.alibaba.dubbo.common.extension.Activate) activate).group();
                activateValue = ((com.alibaba.dubbo.common.extension.Activate) activate).value();
            } else {
                continue;
            }
            //继续筛选符合条件的激活扩展点
            //1、匹配组group
            //2、URL参数中不包含
            //3、不包含移除的配置
            //4、@Activate没有配置value，或者URL中的参数包含@Activate配置的value
            if (isMatchGroup(group, activateGroup)
                    && !names.contains(name)
                    && !names.contains(REMOVE_VALUE_PREFIX + name)
                    && isActive(activateValue, url)) {
                exts.add(getExtension(name));
            }
        }
        exts.sort(ActivateComparator.COMPARATOR);
    }
    //将URL中指定的扩展点，也加入到返回结果里
    List<T> usrs = new ArrayList<>();
    for (int i = 0; i < names.size(); i++) {
        String name = names.get(i);
        //不包含移除配置
        if (!name.startsWith(REMOVE_VALUE_PREFIX)
                && !names.contains(REMOVE_VALUE_PREFIX + name)) {
            if (DEFAULT_KEY.equals(name)) {
                if (!usrs.isEmpty()) {
                    exts.addAll(0, usrs);
                    usrs.clear();
                }
            } else {
                usrs.add(getExtension(name));
            }
        }
    }
    if (!usrs.isEmpty()) {
        exts.addAll(usrs);
    }
    return exts;
}

```



## 四、Dubbo SPI 和 Java SPI 的区别



**1. 功能特性的对比**

| 功能特性         | Java SPI         | Dubbo SPI    |
| ---------------- | ---------------- | ------------ |
| 获取扩展点       | 支持             | 支持         |
| 依赖注入         | 不支持           | 支持         |
| 自适应扩展点     | 不支持           | 支持         |
| 默认扩展点       | 不支持           | 支持         |
| 激活扩展点       | 不支持           | 支持         |
| 扩展点实例化方式 | 一次性全部实例化 | 用到时实例化 |



**2. 使用方法的对比**

| 使用方法       | Java SPI             | Dubbo SPI                                                    |
| -------------- | -------------------- | ------------------------------------------------------------ |
| 实现类         | ServiceLoader        | ExtensionLoader                                              |
| 初始化         | ServiceLoader.load() | ExtensionLoader.getExtensionLoader()                         |
| 接口定义要求   | 无                   | 标记@SPI注解                                                 |
| 获取扩展点方式 | 遍历                 | 通过key获取、遍历                                            |
| 扩展点加载路径 | META-INF/services    | 1、META-INF/services/；2、META-INF/dubbo/；3、META-INF/dubbo/internal/ |
| 配置文件名     | 接口全限定名         | 接口全限定名                                                 |
| 配置文件内容   | 实现类全限定名       | key-value，key=扩展点名，value=实现类全限定名                |

- Dubbo SPI 扩展点的获取，指的是通过`ExtensionLoader`，获取接口的扩展点实例。整个过程包括了**加载配置**、**实例化**、**依赖注入**等步骤。其中要注意包装类的处理，如果是包装类，则返回的是包装类，而不是当前扩展点。
- **依赖注入**指的是在实例化扩展点时，将依赖的对象注入到当前实例中。说白了，就是调用 **setter** 方法赋值。
- 自适应指的是通过参数，在运行时指定扩展点。Dubbo框架中，获取扩展点的方式，大部分都是先获取自适应扩展点，然后在运行时指定扩展点。
- 激活就是为了简化配置，让用户不用配置就可以使用扩展点。这个功能主要用于集合类型的扩展点。