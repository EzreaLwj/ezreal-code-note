## 一、配置切面顺序
对于一个对象加了多个切面，它们的执行顺序可以由 Order 注解来配置，**Order 注解的值越小，优先级越高，默默认值为**。

切面的执行顺序：调用原生 method 前是按照 order 注解的**顺序**，而调用 method 后是按照 order 注解的**逆序**。<br />![](https://cdn.nlark.com/yuque/0/2024/png/27416797/1711294684657-90ec4ca2-893a-47b4-a8ce-e6b8d869d305.png#averageHue=%23fefdfd&clientId=u530efc0f-ccee-4&from=paste&id=u60fffc6c&originHeight=323&originWidth=685&originalType=url&ratio=1.25&rotation=0&showTitle=false&status=done&style=none&taskId=u9b8c1d9f-2aef-4290-bad2-b238ec55d2e&title=)


## 二、默认 AOP 切面排序
```java
protected List<Advisor> findEligibleAdvisors(Class<?> beanClass, String beanName) {
    //查找实现了Advisor接口的 Advisor
    List<Advisor> candidateAdvisors = findCandidateAdvisors();
    //查找我们自定义的Advisor（放入bean容器中的）
    List<Advisor> eligibleAdvisors = findAdvisorsThatCanApply(candidateAdvisors, beanClass, beanName);
    extendAdvisors(eligibleAdvisors);
    if (!eligibleAdvisors.isEmpty()) {
        eligibleAdvisors = sortAdvisors(eligibleAdvisors);
    }
    return eligibleAdvisors;
}
```

参考文章：<br />[spring 多个切面的执行顺序及原理_如果有两个切面,它们之间的顺序是怎么控制的-CSDN博客](https://blog.csdn.net/qq_32317661/article/details/112310508)
