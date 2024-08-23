# Guava Retry 重试机制源码分析



在进行重试时，我们要考虑以下几点：

- **何时启动重试机制**（发生异常、网络延迟等）；
- **何时结束重试**（调用成功）；
- **重试的时间间隔是多久，即计算等待时间**（固定时间、指数退避等）；
- **如何进行等待**（Thread.sleep）

而在 Guava Retry 库中都提供了这些的解决方法。



## 一、Guava Retry  重试机制使用



引入 guava-retry 库：

```java
<dependency>
    <groupId>com.github.rholder</groupId>
    <artifactId>guava-retrying</artifactId>
    <version>2.0.0</version>
</dependency>
```



示例代码：
```java
@Slf4j
public class FixIntervalRetryStrategy implements RetryStrategy<RpcResponse> {
    @Override
    public RpcResponse doRetry(Callable<RpcResponse> callable) throws Exception {
        Retryer<RpcResponse> retryer = RetryerBuilder.<RpcResponse>newBuilder()
                .retryIfExceptionOfType(Exception.class)
                .withStopStrategy(StopStrategies.stopAfterAttempt(3))
                .withWaitStrategy(WaitStrategies.fixedWait(3, TimeUnit.SECONDS))
                .withRetryListener(new RetryListener() {
                    @Override
                    public <V> void onRetry(Attempt<V> attempt) {
                        // 监听重试机制
                        log.info("重试次数：{}", attempt.getAttemptNumber());
                    }
                })
                .build();
        return retryer.call(callable);
    }
}
```

- **retryIfExceptionOfType**：在发生什么类型的异常时进行重试；
- **withStopStrategy**：何时结束重试；
- **withWaitStrategy**：每次等待多久后进行再次重试；
- **withRetryListener**：定义重试的监听器；



1）对于何时进行重试，Guava 的 RetryerBuilder 类给我们提供了很多方法：

```java
// 在发生Exception异常时触发重试
public RetryerBuilder<V> retryIfException() {
    rejectionPredicate = Predicates.or(rejectionPredicate, new ExceptionClassPredicate<V>(Exception.class));
    return this;
}

// 在发生RuntimeException异常时触发重试
public RetryerBuilder<V> retryIfRuntimeException() {
    rejectionPredicate = Predicates.or(rejectionPredicate, new ExceptionClassPredicate<V>(RuntimeException.class));
    return this;
}

// 在发生指定Exception异常时触发重试
public RetryerBuilder<V> retryIfExceptionOfType(@Nonnull Class<? extends Throwable> exceptionClass) {
    Preconditions.checkNotNull(exceptionClass, "exceptionClass may not be null");
    rejectionPredicate = Predicates.or(rejectionPredicate, new ExceptionClassPredicate<V>(exceptionClass));
    return this;
}

public RetryerBuilder<V> retryIfException(@Nonnull Predicate<Throwable> exceptionPredicate) {
    Preconditions.checkNotNull(exceptionPredicate, "exceptionPredicate may not be null");
    rejectionPredicate = Predicates.or(rejectionPredicate, new ExceptionPredicate<V>(exceptionPredicate));
    return this;
}

public RetryerBuilder<V> retryIfResult(@Nonnull Predicate<V> resultPredicate) {
    Preconditions.checkNotNull(resultPredicate, "resultPredicate may not be null");
    rejectionPredicate = Predicates.or(rejectionPredicate, new ResultPredicate<V>(resultPredicate));
    return this;
}
```



2）对于重试间隔，Guava 的 WaitStrategies 给我们提供了很多种策略：

- **FixedWaitStrategy**：固定时间进行重试；
- **RandomWaitStrategy**：随机等待时间进行重试；
- **IncrementingWaitStrategy**：根据失败次数计算等待时间
- **ExponentialWaitStrategy**：随着指数倍数增长；
- **FibonacciWaitStrategy**：随着失败尝试次数的增加，等待时间按照斐波那契数列增长；
- **CompositeWaitStrategy**：这个策略类的特点是将多个不同的等待策略组合在一起，并按顺序将这些策略的等待时间相加，以计算总的等待时间；
- **ExceptionWaitStrategy**：根据指定异常自定义过期时间；



3）对于何时结束重试，Guava 的 StopStrategies 给我们提供了很多种策略：

- **StopAfterDelayStrategy**：在延迟多久后停止重试；
- **StopAfterAttemptStrategy**：在重试指定次数后停止重试；
- **NeverStopStrategy**：从不停止重试；





4）对于等待调用，Guava 只提供了一个类 ThreadSleepStrategy：

```java
@Immutable
private static class ThreadSleepStrategy implements BlockStrategy {

    @Override
    public void block(long sleepTime) throws InterruptedException {
        Thread.sleep(sleepTime);
    }
}
```

- 实质上是调用 Thread.sleep 方法进行阻塞等待；

## 二、重试机制的核心流程



### 2.1 构建 Retry 类

我们先看看 RetryBuilder 的 build 方法，它是如何构建出 Retry 的：

```java
public Retryer<V> build() {
    AttemptTimeLimiter<V> theAttemptTimeLimiter = attemptTimeLimiter == null ? AttemptTimeLimiters.<V>noTimeLimit() : attemptTimeLimiter;
    StopStrategy theStopStrategy = stopStrategy == null ? StopStrategies.neverStop() : stopStrategy;
    WaitStrategy theWaitStrategy = waitStrategy == null ? WaitStrategies.noWait() : waitStrategy;
    BlockStrategy theBlockStrategy = blockStrategy == null ? BlockStrategies.threadSleepStrategy() : blockStrategy;

    return new Retryer<V>(theAttemptTimeLimiter, theStopStrategy, theWaitStrategy, theBlockStrategy, rejectionPredicate, listeners);
}
```

- 该方法会设置停止策略，阻塞策略，等待策略以及 theAttemptTimeLimiter，其中 theAttemptTimeLimiter 的作用是确保重试方法调用时不会超过指定时间限制，避免阻塞进程，它可以设置为无限制等待或者指定时间等待。
- 我们还需要注意 rejectionPredicate 这个参数，这个参数是**判断是否进行重试的关键**。



rejectionPredicate 的构建我们需要 RetryBuilder 类里面的方法：

```java
public RetryerBuilder<V> retryIfExceptionOfType(@Nonnull Class<? extends Throwable> exceptionClass) {
    Preconditions.checkNotNull(exceptionClass, "exceptionClass may not be null");
    rejectionPredicate = Predicates.or(rejectionPredicate, new ExceptionClassPredicate<V>(exceptionClass));
    return this;
}
public static <T extends @Nullable Object> Predicate<T> or(
  	Predicate<? super T> first, Predicate<? super T> second) {
	return new OrPredicate<>(Predicates.<T>asList(checkNotNull(first), checkNotNull(second)));
}
// 這個是OrPredicate的構造函數
 private OrPredicate(List<? extends Predicate<? super T>> components) {
  this.components = components;
}
```

- 通过将Predicate的判断实现类封装到 components 数组中，然后遍历该数组查找符合条件当前重试条件的一个，如果没有符合条件意味着当前不需要重试；

其中 Predicate 接口的实现类是 ExceptionClassPredicate，是 RetryBuilder 的内部类：

```java
private static final class ExceptionClassPredicate<V> implements Predicate<Attempt<V>> {

    private Class<? extends Throwable> exceptionClass;

    public ExceptionClassPredicate(Class<? extends Throwable> exceptionClass) {
        this.exceptionClass = exceptionClass;
    }

    @Override
    public boolean apply(Attempt<V> attempt) {
        // 判断当前重试中是否存在异常
        if (!attempt.hasException()) {
            return false;
        }
        return exceptionClass.isAssignableFrom(attempt.getExceptionCause().getClass());
    }
}
```

- Attempt 是当前重试动作的抽象；



### 2.2 执行重试流程

创建出 Retry 后，我们看看 Retry 的 call 方法：

```java
public V call(Callable<V> callable) throws ExecutionException, RetryException {
    long startTime = System.nanoTime();
    // 循环记录重试次数
    for (int attemptNumber = 1; ; attemptNumber++) {
        Attempt<V> attempt;
        try {
            // 执行callable接口方法
            V result = attemptTimeLimiter.call(callable);
			// 封装重试结果
            attempt = new ResultAttempt<V>(result, attemptNumber, TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startTime));
        } catch (Throwable t) {
            // 重试执行如果发生异常就封装到ExceptionAttempt中
            attempt = new ExceptionAttempt<V>(t, attemptNumber, TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startTime));
        }
		// 调用重试监听器
        for (RetryListener listener : listeners) {
            listener.onRetry(attempt);
        }
		// 判断是否需要进行重试
        if (!rejectionPredicate.apply(attempt)) {
            return attempt.get();
        }
        // 停止策略判断是否需要终止当前重试流程
        if (stopStrategy.shouldStop(attempt)) {
            throw new RetryException(attemptNumber, attempt);
        } else {
            // 调用等待机制计算等待时间
            long sleepTime = waitStrategy.computeSleepTime(attempt);
            try {
                // 阻塞策略进行睡眠等待
                blockStrategy.block(sleepTime);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new RetryException(attemptNumber, attempt);
            }
        }
    }
}

```



该方法就是调用重试机制核心方法，它的主流程包括以下步骤：

- 执行重试方法，判断当前是否存在异常信息决定是否创建 ExceptionAttempt；
- 接着调用所有重试监听器；
- 根据 Attempt 的 hasException 方法，在 rejectionPredicate 类中判断是否需要继续重试；
- 若需要重试，则先根据 stopStrategy 判断当前重试是否需要结束；
- 如果不需要结束，则再根据 waitStrategy 计算出当前需要暂停的时间；
- 然后调用 blockStrategy 进行睡眠等待；



## 三、收获

- 通过策略模式，提供不同的等待策略，停止策略供用户选择，同时用户可以自定义策略，只要实现特定的接口即可；
- call 方法的流程符合依赖倒置原则，对于不同的处理过程（等待、停止、阻塞），符合依赖倒置原则，程序依赖于抽象接口，而不是具体实现。