## 一、什么是 MVC 
MVC 是一种软件设计模式，包括**模型**（Model），**视图**（View），**控制器**（Controller），MVC 的目的就是把应用程序的表示（View）和处理（Controller）分开，把应用程序的数据和模型（Model）分开。<br />**模型（Model）**：表示**应用程序的核心处理逻辑和数据**，用于处理**对数据的输入、输出、更新和存储**。模型不关注如何向用户展示数据，只关注数据本身和对数据的操作。<br />**视图（View）**：表示**应用程序中的界面**，用于**表示模型中的数据**。视图并不关心数据的处理逻辑和方式，只关注如何呈现数据与用户进行交互。<br />**控制器（Controller）**：表示**应用程序的处理逻辑**，用于控制视图与模型之间的交互。通常包括**视图事件的触发和处理**，**响应用户的输入与视图的变化**，并对模型进行操作。将用户的输入转化为对模型的操作，从而实现视图与模型之间的解耦。

## 二、SpringMVC 执行流程
### 2.1 执行流程
![](https://cdn.nlark.com/yuque/0/2023/png/27416797/1699882598536-3793e046-fef8-4b82-b021-d33f13ed8e1d.png?x-oss-process=image%2Fformat%2Cwebp%2Fresize%2Cw_1920%2Climit_0#averageHue=%230d0c0c&from=url&id=MtwJj&originHeight=874&originWidth=1920&originalType=binary&ratio=1.25&rotation=0&showTitle=false&status=done&style=none&title=)

对于 Http 请求来说，tomcat 执行了 HttpService#service 方法，继承了 HttpServlet 的 FrameworkServlet 则是执行 doService 方法，而 SpringMVC 的 DispatcherServlet 则是继承了 FrameworkServlet，进入到 SpringMVC 的流程中，在 DispatcherServlet#doDispatch 的流程如下：

1. 先通过 HandlerMapping 拿到 request 对应的 HandlerExcutionChain，然后再拿到 HandlerExecutionChain 中 hanlder 对应的 HandlerAdapter，执行 HandlerExcutionChain 中的 Interceptor#prehandle 方法；
2. 再通过 HandlerAdapter 去执行 handler，hanlder 其实对应之前注册的 HandlerMethod，所以要执行 handler.invoke，不过在这之前要去判断参数，这一步需要参数解析 HandlerMethodArgumentResolver。反射调用完毕后，需要调用返回值解析器HandlerMethodReturnValueHandler（适配器模式&组合模式&策略模式）；
3. 真正方法执行完了之后，在执行 HandlerExcutionChain 中 Interceptor#postHandle 方法进行拦截器的后置处理；
4. SpringMVC 执行完之后返回的是 ModelAndView，所以我们还需要对 ModelAndView 进行 render，即把 ModelAndView 中的 view 渲染到 response 中；
5. 当发生异常时，会将异常拉到用户业务自己的异常处理方法中，这是也需要对参数和返回值进行 custom，此时就需要用到 HandlerExceptionResolver 系列了。因为用户标记的 @ExceptionHandler方法已经被 ExceptionHandlerMethodResolver 找到并且注册，只需要调用该方法就可以对异常进行处理，此时的方法调用和之前的 hanlder 几乎没有区别了。

### 
## 三、源码分析

### 3.1 DispartServlet 的自动装配
在 spring.factories 中自动引用 DispatcherServletAutoConfiguration<br />![image.png](https://cdn.nlark.com/yuque/0/2023/png/27416797/1695013632982-e8ec11aa-e88d-4860-9401-ae8c0c96c398.png#averageHue=%23fbf9f6&clientId=uab305d80-84c1-4&from=paste&height=611&id=u4fca69f0&originHeight=764&originWidth=1851&originalType=binary&ratio=1.25&rotation=0&showTitle=false&size=194473&status=done&style=none&taskId=uc12616b1-4ca1-4f72-9535-f992dd28293&title=&width=1480.8)

里面有一个内部类 DispatcherServletConfiguration，在这里创建 DispatcherServlet
```java
@Configuration(
        proxyBeanMethods = false
    )
@Conditional({DefaultDispatcherServletCondition.class})
@ConditionalOnClass({ServletRegistration.class})
@EnableConfigurationProperties({WebMvcProperties.class})
protected static class DispatcherServletConfiguration {
    protected DispatcherServletConfiguration() {
    }

    @Bean(
        name = {"dispatcherServlet"}
    )
    public DispatcherServlet dispatcherServlet(WebMvcProperties webMvcProperties) {
        DispatcherServlet dispatcherServlet = new DispatcherServlet();
        dispatcherServlet.setDispatchOptionsRequest(webMvcProperties.isDispatchOptionsRequest());
        dispatcherServlet.setDispatchTraceRequest(webMvcProperties.isDispatchTraceRequest());
        dispatcherServlet.setThrowExceptionIfNoHandlerFound(webMvcProperties.isThrowExceptionIfNoHandlerFound());
        dispatcherServlet.setPublishEvents(webMvcProperties.isPublishRequestHandledEvents());
        dispatcherServlet.setEnableLoggingRequestDetails(webMvcProperties.isLogRequestDetails());
        return dispatcherServlet;
    }

    @Bean
    @ConditionalOnBean({MultipartResolver.class})
    @ConditionalOnMissingBean(
        name = {"multipartResolver"}
    )
    public MultipartResolver multipartResolver(MultipartResolver resolver) {
        return resolver;
    }
}
```

### 3.2 源码流程

1. SpringBoot 创建 `RequestMappingHandlerMapping`  对象，该对象就会去扫描含有 @Controller 注解的对象
   1. 创建该对象时会调用`RequestMappingHandlerMapping` 的 `afterPropertiesSet` 初始化方法，该初始化方法
```java
@Override
@SuppressWarnings("deprecation")
public void afterPropertiesSet() {
	
	//...
	super.afterPropertiesSet();
}
```

   2. 调用父类 AbstractHandlerMethodMapping 的初始化方法
```java
@Override
public void afterPropertiesSet() {
	initHandlerMethods();
}
```

   3. 通过 `RequestMappingHandlerMapping` 把有 Controller 注解和 RequestMapping 注解的类写入到 MapperRegister 中
```java
// 判断是否是 Controller 注解或者 RequestMapping 注解
@Override
protected boolean isHandler(Class<?> beanType) {
    return (AnnotatedElementUtils.hasAnnotation(beanType, Controller.class) ||
            AnnotatedElementUtils.hasAnnotation(beanType, RequestMapping.class));
}

// 初始化 HandlerMethods
protected void initHandlerMethods() {
    for (String beanName : getCandidateBeanNames()) {
        if (!beanName.startsWith(SCOPED_TARGET_NAME_PREFIX)) {
            // 根据beanName获取对应的Bean的class类
            processCandidateBean(beanName);
        }
    }

    // 获取所有的HandlerMapping并初始化
    handlerMethodsInitialized(getHandlerMethods());
}

protected void processCandidateBean(String beanName) {
    Class<?> beanType = null;
    try {
        beanType = obtainApplicationContext().getType(beanName);
    }
    catch (Throwable ex) {
        // An unresolvable bean type, probably from a lazy bean - let's ignore it.
        if (logger.isTraceEnabled()) {
            logger.trace("Could not resolve type for bean '" + beanName + "'", ex);
        }
    }
    if (beanType != null && isHandler(beanType)) {
        // 如果是controller就进入该方法
        detectHandlerMethods(beanName);
    }
}
protected void detectHandlerMethods(Object handler) {
    // 获取handler对应的class对象
    Class<?> handlerType = (handler instanceof String ?
            obtainApplicationContext().getType((String) handler) : handler.getClass());

    if (handlerType != null) {
        Class<?> userType = ClassUtils.getUserClass(handlerType);
        // 获取这个controller所有的method T->RequestMethod
        Map<Method, T> methods = MethodIntrospector.selectMethods(userType,
                (MethodIntrospector.MetadataLookup<T>) method -> {
                    try {
                        return getMappingForMethod(method, userType);
                    }
                    catch (Throwable ex) {
                        throw new IllegalStateException("Invalid mapping on handler class [" +
                                userType.getName() + "]: " + method, ex);
                    }
                });
        
        if (logger.isTraceEnabled()) {
            logger.trace(formatMappings(userType, methods));
        }
        // method：全类名+方法名+方法参数
        // mapping：RequestMethodInfo对象，里面含有路径参数
        methods.forEach((method, mapping) -> {
            Method invocableMethod = AopUtils.selectInvocableMethod(method, userType);
            //
            registerHandlerMethod(handler, invocableMethod, mapping);
        });
    }
}

// 最后调用 processCandidateBean 中的 detectHandlerMethods 方法中的 registerHandlerMethod 方法
protected void registerHandlerMethod(Object handler, Method method, T mapping) {
		this.mappingRegistry.register(mapping, handler, method);
}


public void register(T mapping, Object handler, Method method) {
    // Assert that the handler method is not a suspending one.
    if (KotlinDetector.isKotlinType(method.getDeclaringClass())) {
        Class<?>[] parameterTypes = method.getParameterTypes();
        if ((parameterTypes.length > 0) && "kotlin.coroutines.Continuation".equals(parameterTypes[parameterTypes.length - 1].getName())) {
            throw new IllegalStateException("Unsupported suspending handler method detected: " + method);
        }
    }
    this.readWriteLock.writeLock().lock();
    try {
        // 封装为HandlerMethod
        HandlerMethod handlerMethod = createHandlerMethod(handler, method);
        validateMethodMapping(handlerMethod, mapping);
        // 使用mapping作为键，handlerMethod作为值
        // 主要关心这个
        this.mappingLookup.put(mapping, handlerMethod);

        List<String> directUrls = getDirectUrls(mapping);
        for (String url : directUrls) {
            this.urlLookup.add(url, mapping);
        }

        String name = null;
        if (getNamingStrategy() != null) {
            name = getNamingStrategy().getName(handlerMethod, mapping);
            addMappingName(name, handlerMethod);
        }

        CorsConfiguration corsConfig = initCorsConfiguration(handler, method, mapping);
        if (corsConfig != null) {
            this.corsLookup.put(handlerMethod, corsConfig);
        }

        this.registry.put(mapping, new MappingRegistration<>(mapping, handlerMethod, directUrls, name));
    }
    finally {
        this.readWriteLock.writeLock().unlock();
    }
}


```

- handler：Controller 类名称
- mapping：映射的路径（RequestInfo）
- method：对应映射路径的方法

![image.png](https://cdn.nlark.com/yuque/0/2023/png/27416797/1693408910089-5628f302-f87d-4b2d-8097-603d16da82a4.png#averageHue=%23fcfbf9&clientId=u471cc24e-a5df-4&from=paste&height=223&id=ubf311be5&originHeight=279&originWidth=1278&originalType=binary&ratio=1.25&rotation=0&showTitle=false&size=30972&status=done&style=none&taskId=uce8c288e-2cc9-4d2d-b961-ba2c1341898&title=&width=1022.4)

MappingRegistry 对象
```java
class MappingRegistry {

    /*
        T -> RequestInfo
    */
    // RequestMappingInfo->MappingRegistration
    private final Map<T, MappingRegistration<T>> registry = new HashMap<>();

    // RequestMappingInfo->Handler
    private final Map<T, HandlerMethod> mappingLookup = new LinkedHashMap<>();

    // url->RequestMappingInfo
    private final MultiValueMap<String, T> urlLookup = new LinkedMultiValueMap<>();

    private final Map<String, List<HandlerMethod>> nameLookup = new ConcurrentHashMap<>();

    private final Map<HandlerMethod, CorsConfiguration> corsLookup = new ConcurrentHashMap<>();

    private final ReentrantReadWriteLock readWriteLock = new ReentrantReadWriteLock();

    /**
     * Return all mappings and handler methods. Not thread-safe.
     * @see #acquireReadLock()
     */
    public Map<T, HandlerMethod> getMappings() {
        return this.mappingLookup;
    }

    //...
}
```

HandlerExecutionChain 对象
```java
public class HandlerExecutionChain {

	private static final Log logger = LogFactory.getLog(HandlerExecutionChain.class);

    // 对应的处理器
	private final Object handler;

	@Nullable
    // 对应的拦截器
	private HandlerInterceptor[] interceptors;

	@Nullable
	private List<HandlerInterceptor> interceptorList;

	private int interceptorIndex = -1;
}
```

HanlderMethod 类
```java
public class HandlerMethod {

	/** Public for wrapping with fallback logger. */
	public static final Log defaultLogger = LogFactory.getLog(HandlerMethod.class);

    // controller bean的名称
	private final Object bean;

	@Nullable
	private final BeanFactory beanFactory;

    // bean的Class类
	private final Class<?> beanType;

    //method类
	private final Method method;

	private final Method bridgedMethod;

    private final MethodParameter[] parameters;

	@Nullable
	private HandlerMethod resolvedFromHandlerMethod;

	protected Log logger = defaultLogger;
}
```

2. 在 `DispatcherServlet` 中接受处理流程，首先在 `handlerMapping` 中获取对应的 `HandlerExecutionChain`。（即根据 request 中的 url 找到对应的 handlerMethod ，然后把 handlerMethod 封装到 HandlerExecutionChain 中）—— 责任链模式
> HandlerExecutionChain 包括 handler 和所有的 interceptor

Spring MVC提供了多种HandlerMapping实现，以支持不同的URL映射策略，包括：

   1. RequestMappingHandlerMapping：根据@RequestMapping注解配置的URL映射来确定处理器(Controller)。
   2. BeanNameUrlHandlerMapping：根据Controller的bean名称来确定处理器(Controller)。
   3. SimpleUrlHandlerMapping：根据配置的URL路径和处理器(Controller)的映射关系来确定处理器(Controller)

在Spring MVC中，HandlerMapping的作用是将传入的请求映射到相应的处理器(Controller)类和方法。它负责确定请求的URL与特定处理器(Controller)之间的映射关系，并根据请求的URL和其他标识符将请求分发到适当的处理器(Controller)。
```java
protected void doDispatch(HttpServletRequest request, HttpServletResponse response) throws Exception {
    //...
    processedRequest = checkMultipart(request);
    multipartRequestParsed = (processedRequest != request);
    
    // Determine handler for the current request.
    mappedHandler = getHandler(processedRequest);
    if (mappedHandler == null) {
        noHandlerFound(processedRequest, response);
        return;
    }
    
    //...
}

// getHandler
@Nullable
protected HandlerExecutionChain getHandler(HttpServletRequest request) throws Exception {
    if (this.handlerMappings != null) {
        for (HandlerMapping mapping : this.handlerMappings) {
            HandlerExecutionChain handler = mapping.getHandler(request);
            if (handler != null) {
                return handler;
            }
        }
    }
    return null;
}

@Override
@Nullable
public final HandlerExecutionChain getHandler(HttpServletRequest request) throws Exception {

    // 获取对应的hanlderMethod
    Object handler = getHandlerInternal(request);
    if (handler == null) {
        handler = getDefaultHandler();
    }
    if (handler == null) {
        return null;
    }
    // Bean name or resolved handler?
    if (handler instanceof String) {
        String handlerName = (String) handler;
        handler = obtainApplicationContext().getBean(handlerName);
    }
	// 将hanlderMethod封装到对应的ExecutionChain中
    HandlerExecutionChain executionChain = getHandlerExecutionChain(handler, request);

    if (logger.isTraceEnabled()) {
        logger.trace("Mapped to " + handler);
    }
    else if (logger.isDebugEnabled() && !request.getDispatcherType().equals(DispatcherType.ASYNC)) {
        logger.debug("Mapped to " + executionChain.getHandler());
    }

    if (hasCorsConfigurationSource(handler) || CorsUtils.isPreFlightRequest(request)) {
        CorsConfiguration config = (this.corsConfigurationSource != null ? this.corsConfigurationSource.getCorsConfiguration(request) : null);
        CorsConfiguration handlerConfig = getCorsConfiguration(handler, request);
        config = (config != null ? config.combine(handlerConfig) : handlerConfig);
        executionChain = getCorsHandlerExecutionChain(request, executionChain, config);
    }

    return executionChain;
}

@Override
protected HandlerMethod getHandlerInternal(HttpServletRequest request) throws Exception {
    String lookupPath = getUrlPathHelper().getLookupPathForRequest(request);
    request.setAttribute(LOOKUP_PATH, lookupPath);
    this.mappingRegistry.acquireReadLock();
    try {
        // 这里就是获取对应的 handlerMethod
        HandlerMethod handlerMethod = lookupHandlerMethod(lookupPath, request);
        return (handlerMethod != null ? handlerMethod.createWithResolvedBean() : null);
    }
    finally {
        this.mappingRegistry.releaseReadLock();
    }
}

@Nullable
protected HandlerMethod lookupHandlerMethod(String lookupPath, HttpServletRequest request) throws Exception {
    List<Match> matches = new ArrayList<>();
    // 从 urllookup中获取对应的路径
    List<T> directPathMatches = this.mappingRegistry.getMappingsByUrl(lookupPath);
    if (directPathMatches != null) {
        addMatchingMappings(directPathMatches, matches, request);
    }
    if (matches.isEmpty()) {
        // No choice but to go through all mappings...
        addMatchingMappings(this.mappingRegistry.getMappings().keySet(), matches, request);
    }

    // 根据路径找到最适合的HandlerMethod然后返回即可
    if (!matches.isEmpty()) {
        Match bestMatch = matches.get(0);
        if (matches.size() > 1) {
            Comparator<Match> comparator = new MatchComparator(getMappingComparator(request));
            matches.sort(comparator);
            bestMatch = matches.get(0);
            if (logger.isTraceEnabled()) {
                logger.trace(matches.size() + " matching mappings: " + matches);
            }
            if (CorsUtils.isPreFlightRequest(request)) {
                return PREFLIGHT_AMBIGUOUS_MATCH;
            }
            Match secondBestMatch = matches.get(1);
            if (comparator.compare(bestMatch, secondBestMatch) == 0) {
                Method m1 = bestMatch.handlerMethod.getMethod();
                Method m2 = secondBestMatch.handlerMethod.getMethod();
                String uri = request.getRequestURI();
                throw new IllegalStateException(
                        "Ambiguous handler methods mapped for '" + uri + "': {" + m1 + ", " + m2 + "}");
            }
        }
        request.setAttribute(BEST_MATCHING_HANDLER_ATTRIBUTE, bestMatch.handlerMethod);
        handleMatch(bestMatch.mapping, lookupPath, request);
        return bestMatch.handlerMethod;
    }
    else {
        return handleNoMatch(this.mappingRegistry.getMappings().keySet(), lookupPath, request);
    }
}
```

- mappedHandler 的类型为 HandlerExecutionChain，通过 getHandler 获取对应的 handler

3. 获取 HandlerAdapter，执行 handler 方法（执行的步骤主要在 RequestMappingHandlerAdapter 中）

在Spring MVC中，HandlerAdapter的作用是将请求分派给适当的处理器(Controller)方法，并处理请求的执行过程。

HandlerAdapter负责以下任务：

1. **执行处理器(Controller)方法**：HandlerAdapter负责调用适当的处理器(Controller)方法来处理请求。它根据请求中的URL和其他标识符，找到并调用匹配的处理器(Controller)的方法。
2. **处理请求参数的绑定**：HandlerAdapter负责处理请求中的参数绑定。它根据请求的方式（GET、POST等）以及处理器(Controller)方法的参数注解（如@RequestParam、@PathVariable等）来绑定请求参数到方法参数。
3. **处理返回结果的转换**：HandlerAdapter负责处理处理器(Controller)方法的返回结果。它将Controller方法的返回值转换为合适的响应结果，例如将对象转换为JSON或XML格式。
4. **处理异常情况**：HandlerAdapter负责处理处理器(Controller)方法可能抛出的异常。它可以根据异常类型选择合适的错误页面或错误处理逻辑来处理异常情况。
5. **支持异步请求处理**：HandlerAdapter可以处理异步请求，例如异步控制器(Method)。

Spring MVC 提供了多种 HandlerAdapter 实现，以支持不同类型的处理器(Controller)和请求处理策略，包括：

1. RequestMappingHandlerAdapter：处理使用@RequestMapping注解配置的处理器(Controller)。
2. SimpleControllerHandlerAdapter：处理实现了Controller接口的处理器(Controller)。
3. HttpRequestHandlerAdapter：处理实现了HttpRequestHandler接口的处理器(Controller)。

通过配置不同的HandlerAdapter，我们可以灵活地选择适合应用程序需求的请求处理方式，并且能够处理不同类型的处理器(Controller)方法。
```java
// Determine handler adapter for the current request.
HandlerAdapter ha = getHandlerAdapter(mappedHandler.getHandler());

// Process last-modified header, if supported by the handler.
String method = request.getMethod();
boolean isGet = "GET".equals(method);
if (isGet || "HEAD".equals(method)) {
    long lastModified = ha.getLastModified(request, mappedHandler.getHandler());
    if (new ServletWebRequest(request, response).checkNotModified(lastModified) && isGet) {
        return;
    }
}

if (!mappedHandler.applyPreHandle(processedRequest, response)) {
    return;
}

// Actually invoke the handler.
mv = ha.handle(processedRequest, response, mappedHandler.getHandler());

// 最终执行的方法
protected ModelAndView invokeHandlerMethod(HttpServletRequest request,
			HttpServletResponse response, HandlerMethod handlerMethod) throws Exception {
    //...
    // 调用反射的方法
    invocableMethod.invokeAndHandle(webRequest, mavContainer);

    //...
    // 返回 modelAndView
    getModelAndView(mavContainer, modelFactory, webRequest);
}

public void invokeAndHandle(ServletWebRequest webRequest, ModelAndViewContainer mavContainer,
			Object... providedArgs) throws Exception {

    // 获得返回结果
    Object returnValue = invokeForRequest(webRequest, mavContainer, providedArgs);

	// 处理返回结果
    this.returnValueHandlers.handleReturnValue(
            returnValue, getReturnValueType(returnValue), mavContainer, webRequest);

}

// InvocableHandlerMethod 类
@Nullable
protected Object doInvoke(Object... args) throws Exception {
    Method method = this.getBridgedMethod();
    ReflectionUtils.makeAccessible(method);
}
```

- ha.handle 方法会最终调用  invokeHandlerMethod 执行 HandlerExecutionChain 的方法


4.  handleReturnValue 处理返回结果
```java
public void handleReturnValue(@Nullable Object returnValue, MethodParameter returnType, ModelAndViewContainer mavContainer, NativeWebRequest webRequest) throws Exception {
    // 选择返回值处理器
    HandlerMethodReturnValueHandler handler = this.selectHandler(returnValue, returnType);
    if (handler == null) {
        throw new IllegalArgumentException("Unknown return value type: " + returnType.getParameterType().getName());
    } else {
        // 执行处理器方法 
        handler.handleReturnValue(returnValue, returnType, mavContainer, webRequest);
    }
}

 // 选择返回值处理器
@Nullable
private HandlerMethodReturnValueHandler selectHandler(@Nullable Object value, MethodParameter returnType) {
    boolean isAsyncValue = isAsyncReturnValue(value, returnType);
    for (HandlerMethodReturnValueHandler handler : this.returnValueHandlers) {
        if (isAsyncValue && !(handler instanceof AsyncHandlerMethodReturnValueHandler)) {
            continue;
        }
        if (handler.supportsReturnType(returnType)) {
            return handler;
        }
    }
    return null;
}

public class RequestResponseBodyMethodProcessor {
    
    // 如果带有 @ResponseBody 将会选择 RequestResponseBodyMethodProcessor 处理器
    @Override
    public boolean supportsReturnType(MethodParameter returnType) {
        // 重点
        return (AnnotatedElementUtils.hasAnnotation(returnType.getContainingClass(), ResponseBody.class) ||
                returnType.hasMethodAnnotation(ResponseBody.class));
    }
    @Override
    public void handleReturnValue(@Nullable Object returnValue, MethodParameter returnType,
            ModelAndViewContainer mavContainer, NativeWebRequest webRequest)
            throws IOException, HttpMediaTypeNotAcceptableException, HttpMessageNotWritableException {
    
        mavContainer.setRequestHandled(true);
        ServletServerHttpRequest inputMessage = createInputMessage(webRequest);
        ServletServerHttpResponse outputMessage = createOutputMessage(webRequest);
    
        // Try even with null return value. ResponseBodyAdvice could get involved.
        writeWithMessageConverters(returnValue, returnType, inputMessage, outputMessage);
    }
}
```
如果带有 @ResponseBody，则会找到 `RequestResponseBodyMethodProcessor`，然后执行 handleReturnValue 方法
```java
@Override
public void handleReturnValue(@Nullable Object returnValue, MethodParameter returnType,
        ModelAndViewContainer mavContainer, NativeWebRequest webRequest)
        throws IOException, HttpMediaTypeNotAcceptableException, HttpMessageNotWritableException {

    mavContainer.setRequestHandled(true);
    ServletServerHttpRequest inputMessage = createInputMessage(webRequest);
    ServletServerHttpResponse outputMessage = createOutputMessage(webRequest);

    // Try even with null return value. ResponseBodyAdvice could get involved.
    writeWithMessageConverters(returnValue, returnType, inputMessage, outputMessage);
}
```


进入 writeWithMessageConverters 进行选择消息转换器

1. 选择合适的 Content-Type
```java
MediaType selectedMediaType = null;
MediaType contentType = outputMessage.getHeaders().getContentType();
boolean isContentTypePreset = contentType != null && contentType.isConcrete();
if (isContentTypePreset) {
    if (logger.isDebugEnabled()) {
        logger.debug("Found 'Content-Type:" + contentType + "' in response");
    }
    selectedMediaType = contentType;
}
else {
    HttpServletRequest request = inputMessage.getServletRequest();
    List<MediaType> acceptableTypes;
    try {
        acceptableTypes = getAcceptableMediaTypes(request);
    }
    catch (HttpMediaTypeNotAcceptableException ex) {
        int series = outputMessage.getServletResponse().getStatus() / 100;
        if (body == null || series == 4 || series == 5) {
            if (logger.isDebugEnabled()) {
                logger.debug("Ignoring error response content (if any). " + ex);
            }
            return;
        }
        throw ex;
    }
    List<MediaType> producibleTypes = getProducibleMediaTypes(request, valueType, targetType);

    if (body != null && producibleTypes.isEmpty()) {
        throw new HttpMessageNotWritableException(
                "No converter found for return value of type: " + valueType);
    }
    List<MediaType> mediaTypesToUse = new ArrayList<>();
    for (MediaType requestedType : acceptableTypes) {
        for (MediaType producibleType : producibleTypes) {
            if (requestedType.isCompatibleWith(producibleType)) {
                mediaTypesToUse.add(getMostSpecificMediaType(requestedType, producibleType));
            }
        }
    }
    if (mediaTypesToUse.isEmpty()) {
        if (logger.isDebugEnabled()) {
            logger.debug("No match for " + acceptableTypes + ", supported: " + producibleTypes);
        }
        if (body != null) {
            throw new HttpMediaTypeNotAcceptableException(producibleTypes);
        }
        return;
    }

    MediaType.sortBySpecificityAndQuality(mediaTypesToUse);

    for (MediaType mediaType : mediaTypesToUse) {
        if (mediaType.isConcrete()) {
            selectedMediaType = mediaType;
            break;
        }
        else if (mediaType.isPresentIn(ALL_APPLICATION_MEDIA_TYPES)) {
            selectedMediaType = MediaType.APPLICATION_OCTET_STREAM;
            break;
        }
    }

    if (logger.isDebugEnabled()) {
        logger.debug("Using '" + selectedMediaType + "', given " +
                acceptableTypes + " and supported " + producibleTypes);
    }
}

```

2. 选择合适的消息转换器
```java
if (selectedMediaType != null) {
    selectedMediaType = selectedMediaType.removeQualityValue();
    for (HttpMessageConverter<?> converter : this.messageConverters) {
        GenericHttpMessageConverter genericConverter = (converter instanceof GenericHttpMessageConverter ?
                (GenericHttpMessageConverter<?>) converter : null);
        if (genericConverter != null ?
                ((GenericHttpMessageConverter) converter).canWrite(targetType, valueType, selectedMediaType):
                // canWrite 选择合适的消息转换器
                converter.canWrite(valueType, selectedMediaType)) {
            body = getAdvice().beforeBodyWrite(body, returnType, selectedMediaType,
                    (Class<? extends HttpMessageConverter<?>>) converter.getClass(),
                    inputMessage, outputMessage);
            if (body != null) {
                Object theBody = body;
                LogFormatUtils.traceDebug(logger, traceOn ->
                        "Writing [" + LogFormatUtils.formatValue(theBody, !traceOn) + "]");
                addContentDispositionHeader(inputMessage, outputMessage);
                if (genericConverter != null) {
                    // 调用转换器的write方法
                    genericConverter.write(body, targetType, selectedMediaType, outputMessage);
                }
                else {
                    ((HttpMessageConverter) converter).write(body, selectedMediaType, outputMessage);
                }
            }
            else {
                if (logger.isDebugEnabled()) {
                    logger.debug("Nothing to write: null body");
                }
            }
            return;
        }
    }
}


@Override
public final void write(final T t, @Nullable final Type type, @Nullable MediaType contentType,
        HttpOutputMessage outputMessage) throws IOException, HttpMessageNotWritableException {

    final HttpHeaders headers = outputMessage.getHeaders();
    addDefaultHeaders(headers, t, contentType);

    if (outputMessage instanceof StreamingHttpOutputMessage) {
        StreamingHttpOutputMessage streamingOutputMessage = (StreamingHttpOutputMessage) outputMessage;
        streamingOutputMessage.setBody(outputStream -> writeInternal(t, type, new HttpOutputMessage() {
            @Override
            public OutputStream getBody() {
                return outputStream;
            }
            @Override
            public HttpHeaders getHeaders() {
                return headers;
            }
        }));
    }
    else {
        // 最终会调用writeInternal方法
        writeInternal(t, type, outputMessage);
        outputMessage.getBody().flush();
    }
}
```

比如这里就会调用 MappingJackson2HttpMessageConverter 的 writeInternal 方法，将返回值写入到 outputMesssage 中
```java
@Override
protected void writeInternal(Object object, @Nullable Type type, HttpOutputMessage outputMessage)
        throws IOException, HttpMessageNotWritableException {

    MediaType contentType = outputMessage.getHeaders().getContentType();
    JsonEncoding encoding = getJsonEncoding(contentType);

    Class<?> clazz = (object instanceof MappingJacksonValue ?
            ((MappingJacksonValue) object).getValue().getClass() : object.getClass());
    ObjectMapper objectMapper = selectObjectMapper(clazz, contentType);
    Assert.state(objectMapper != null, () -> "No ObjectMapper for " + clazz.getName());

    // 获取ResponseMessage中的输入流
    OutputStream outputStream = StreamUtils.nonClosing(outputMessage.getBody());
    // 封装到一个generator中
    try (JsonGenerator generator = objectMapper.getFactory().createGenerator(outputStream, encoding)) {
        // 写入前缀
        writePrefix(generator, object);

        Object value = object;
        Class<?> serializationView = null;
        FilterProvider filters = null;
        JavaType javaType = null;

        if (object instanceof MappingJacksonValue) {
            MappingJacksonValue container = (MappingJacksonValue) object;
            value = container.getValue();
            serializationView = container.getSerializationView();
            filters = container.getFilters();
        }
        if (type != null && TypeUtils.isAssignable(type, value.getClass())) {
            javaType = getJavaType(type, null);
        }

        // 创建一个ObjectWriter写入对象
        ObjectWriter objectWriter = (serializationView != null ?
                objectMapper.writerWithView(serializationView) : objectMapper.writer());
        if (filters != null) {
            objectWriter = objectWriter.with(filters);
        }
        if (javaType != null && javaType.isContainerType()) {
            objectWriter = objectWriter.forType(javaType);
        }
        SerializationConfig config = objectWriter.getConfig();
        if (contentType != null && contentType.isCompatibleWith(MediaType.TEXT_EVENT_STREAM) &&
                config.isEnabled(SerializationFeature.INDENT_OUTPUT)) {
            objectWriter = objectWriter.with(this.ssePrettyPrinter);
        }
        // 写入值
        objectWriter.writeValue(generator, value);

        // 写入后缀
        writeSuffix(generator, object);
        generator.flush();
    }
    catch (InvalidDefinitionException ex) {
        throw new HttpMessageConversionException("Type definition error: " + ex.getType(), ex);
    }
    catch (JsonProcessingException ex) {
        throw new HttpMessageNotWritableException("Could not write JSON: " + ex.getOriginalMessage(), ex);
    }
}
```

至此，写入完成写回响应值
