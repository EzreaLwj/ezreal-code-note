# 一次慢 SQL 优化过程



## 一、背景

对于公司内部的一个发票管理系统，财务人员经常需要对发票的开票交易进行查询，这里涉及到两张表：发票订单表和发票信息表，我们需要查询**订单 ID**、**开票 APP**、**开票主体**、**订单类型**、**支付渠道**、**支付总额**、**支付状态**、**开票用户的 uid**、**开票用户的 showId**、**支付时间**、**开票时间**、**开票的 InvoiceId**。其中发票订单表中的数据量将近**1个亿**。

其中支付用户的 **showId** 需要使用用户的 uid 进行 **RPC 调用获取**，**开票时间**需要从**发票信息表**中获取，其他字段信息只需要从发票订单表中获取。



## 二、优化过程



### 2.1 原 SQL 存在问题

我们先来看原来的发票订单信息查询代码：

```java
public PageResult<InvoiceTransactionQueryResponse> queryInvoiceTransaction(InvoiceTransactionQueryRequest request) {
    if (StringUtils.isBlank(request.getUid())) {
        String showNo = request.getShowNo();
        if (StringUtils.isNotBlank(showNo)) {
            UserDto userInfo = externalUserService.getUserInfoByShowNo(Long.valueOf(showNo.trim()), APP.BIXIN.getCode());
            if (userInfo == null) {
                throw new UserNotFoundException(InvoiceErrorCode.USER_NOT_EXIST_ERROR, String.format("showNo=%s 用户不存在", showNo));
            }
            request.setUid(String.valueOf(userInfo.getUid()));
        }
    }
    Long queryUid = StringUtils.isNotBlank(request.getUid()) ? Long.parseLong(request.getUid()) : null;
    String invoiceStartTime = request.getInvoiceStartTime();
    String invoiceEndTime = request.getInvoiceEndTime();
    
    // 根据开票时间参数从发票信息表中获取对应invoiceId
    List<String> invoiceNoList = new ArrayList<>();
    if (StringUtils.isNotBlank(invoiceStartTime) || StringUtils.isNotBlank(invoiceEndTime)) {
        invoiceNoList = paymentInvoiceService.getPageInvoiceByCondition(queryUid, invoiceStartTime, invoiceEndTime, request.getPageNo(), request.getPageSize());
    }
    // 查询发票订单表
    PageInfo<PaymentInvoiceOrder> invoiceOrderPageInfo = paymentInvoiceOrderService.getInvoiceTransaction(queryUid, request, invoiceNoList);
    List<PaymentInvoiceOrder> invoiceOrderList = invoiceOrderPageInfo.getList();
    List<InvoiceTransactionQueryResponse> invoiceTransactionQueryResponseList = new ArrayList<>();
    invoiceOrderList.forEach(invoiceOrder -> {
        InvoiceTransactionQueryResponse invoiceTransactionQueryResponse = new InvoiceTransactionQueryResponse();
        Long uid = invoiceOrder.getUid();

        // 用户信息的 RPC 调用
        UserDto userInfo = externalUserService.getUserInfoByUid(uid, APP.BIXIN.getCode());
        invoiceTransactionQueryResponse.setOrderNo(invoiceOrder.getOrderNo());
        invoiceTransactionQueryResponse.setShowNo(null != userInfo ? userInfo.getShowNo().toString() : "");
        invoiceTransactionQueryResponse.setUid(String.valueOf(uid));
        PaymentInvoice paymentInvoice = null;

        // 查询发票具体信息
        String invoiceNo = invoiceOrder.getInvoiceNo();
        if (StringUtils.isNotBlank(invoiceNo)) {
            paymentInvoice = paymentInvoiceService.getInvoice(invoiceNo);
        }
        InvoiceKind invoiceKind = InvoiceKind.getInvoiceKind(invoiceOrder.getOrderType(), invoiceOrder.getTargetCurrency());
        invoiceTransactionQueryResponse.setPayTime(DateUtils.stringFormat(invoiceOrder.getPayTime()));
        invoiceTransactionQueryResponse.setInvoiceApp(invoiceOrder.getInvoiceApp());
        invoiceTransactionQueryResponse.setInvoiceSubject(InvoiceMainEnum.getSubjectByTemplate(invoiceOrder.getInvoiceTemplate(), ""));
        invoiceTransactionQueryResponse.setOrderType(paymentInvoiceOrderService.getQueryOrderType(invoiceKind));
        invoiceTransactionQueryResponse.setPayChannel(StringUtils.isNotBlank(invoiceOrder.getPayChannel()) ? InvoicePayChannel.lookupByName(invoiceOrder.getPayChannel()).getDesc() : "");
        invoiceTransactionQueryResponse.setPayAmount(invoiceOrder.getPayAmount().toPlainString());
        invoiceTransactionQueryResponse.setInvoiceStatus(InvoiceState.getDescByType(invoiceOrder.getInvoiceStatus()));
        invoiceTransactionQueryResponse.setApplyUser(null != paymentInvoice ? paymentInvoice.getApplyUser() : "");
        invoiceTransactionQueryResponse.setInvoiceTime(null != paymentInvoice ? DateUtils.stringFormat(paymentInvoice.getInvoiceDate()) : "");
        invoiceTransactionQueryResponse.setInvoiceNumber(null != paymentInvoice ? paymentInvoice.getInvoiceNumber() : "");
        invoiceTransactionQueryResponseList.add(invoiceTransactionQueryResponse);
    });
    int pages = (int) Math.ceil((invoiceOrderPageInfo.getTotal() + 0.0) / request.getPageSize());

    return PageResult.newPageResult(invoiceTransactionQueryResponseList, pages == request.getPageNo(), invoiceOrderPageInfo.getTotal());
}
```



我们不难可以看到以下的查询问题：

- **问题一**：在查询发票订单表前，要先根据 web 端开票起始时间参数从**发票信息表**中查询符合该开票起始时间内的 invoiceId；
- **问题二**：在 for 循环中拼接数据时，进行了一次 RPC 调用通过用户的 uid 查询用户的 showId 和 一次数据库查询操作获取该发票的具体开票时间；

下面，我们对这两个问题着手进行解决。



### 2.2 在循环中抽取 RPC 调用和数据库查询操作



对于问题二：我们不应该在 for 循环中不断地进行 RPC 调用和数据库查询操作，前者会造成多次的网络调用，频率建立和断开 TCP 连接，后者每次 SQL 查询都会建立一个 SqlSession，创建数据库连接，带来网络开销开销的同时，可能会耗尽连接池的资源，给数据带来压力。

所以，我们的解决办法也十分明显，就是把 for 循环中的 RPC 调用和数据库查询操作提到 for 循环外面，通过批量查询一次把所需要的数据查询出来，代码如下：

```java
public PageResult<InvoiceTransactionQueryResponse> queryInvoiceTransaction(InvoiceTransactionQueryRequest request) {
      
    // 批量查询invoice
    List<String> invoiceList = invoiceOrderList.stream().map(PaymentInvoiceOrder::getInvoiceNo).collect(Collectors.toList());
    Map<String, PaymentInvoice> invoiceMap = paymentInvoiceService.queryInvoiceList(invoiceList).stream().collect(Collectors.toMap(PaymentInvoice::getInvoiceNo, invoice -> invoice));

    // 批量查询uid
    List<Long> uidList = invoiceOrderList.stream().map(PaymentInvoiceOrder::getUid).toList().stream().distinct().toList();
    Map<Long, UserDto> userDtoMap = externalUserService.getUserInfoList(uidList, APP.BIXIN.getCode()).stream().collect(Collectors.toMap(UserDto::getUid, userDto -> userDto));

    List<InvoiceTransactionQueryResponse> invoiceTransactionQueryResponseList = new ArrayList<>();
    invoiceOrderList.forEach(invoiceOrder -> {
        InvoiceTransactionQueryResponse invoiceTransactionQueryResponse = new InvoiceTransactionQueryResponse();
        Long uid = invoiceOrder.getUid();
        // 从Map中获取用户信息
        UserDto userInfo = userDtoMap.get(uid);
        invoiceTransactionQueryResponse.setOrderNo(invoiceOrder.getOrderNo());
        invoiceTransactionQueryResponse.setShowNo(null != userInfo ? userInfo.getShowNo().toString() : "");
        invoiceTransactionQueryResponse.setUid(String.valueOf(uid));
        PaymentInvoice paymentInvoice = null;
        
        // 从Map中获取发票信息
        String invoiceNo = invoiceOrder.getInvoiceNo();
        if (StringUtils.isNotBlank(invoiceNo)) {
            paymentInvoice = invoiceMap.get(invoiceNo);
        }
        //...
    });
    int pages = (int) Math.ceil((invoiceOrderPageInfo.getTotal() + 0.0) / request.getPageSize());

    return PageResult.newPageResult(invoiceTransactionQueryResponseList, pages == request.getPageNo(), invoiceOrderPageInfo.getTotal());
}
```

- 批量查询 invoice 和批量查询用户信息的操作，都是通过 Java 8 提供的 stream 流，借助 `Collectors.toMap()`方法，根据一个集合转换为一个 Map 的存储形式，key 一般为业务 ID，value 为实体类；



得到 Map 之后，我们就可以在 for 循环中根据业务 ID 来获取对应的实体类，相对于网络传输，直接在内存中的操作是十分快的！



### 2.3 数据同步，迁移表数据

对于问题一的解决办法其实有两个：

- **方案一**：在发票信息表中，对 invoiceId 和 invoiceDate 字段加上联合索引，通过联合索引来减少回表查询的成本；
- **方案二**：在发票订单表中加上 invoiceDate 字段，将发票信息表中的 invoiceDate 数据同步到发票订单表；



对比这两种方式，尽管方法一可以提升查询的速度，但相对与方法二而言，减少一次数据库的操作比加上索引进行一次数据库查询要实际得多，所以我们下面采取方案二。

**数据同步任务如下**：

```java
@Slf4j
@JobListener
public class SyncInvoiceDateJob implements JobListener {
    @Value("${invoice.syncInvoiceDate.pageNo:1}")
    private int pageNo = 1;
    @Value("${invoice.syncInvoiceDate.pageSize:10}")
    private int pageSize;
    @Value("${invoice.syncInvoiceDate.syncSwitch:false}")
    private boolean syncSwitch;
    @Resource
    private PaymentInvoiceMapper paymentInvoiceMapper;
    @Resource
    private PaymentInvoiceOrderMapper paymentInvoiceOrderMapper;
    @Override
    public void execute(JobExecutionContext jobExecutionContext) {

        // 每一次执行都要把设置为1
        pageNo = 1;
        String parameter = jobExecutionContext.getParameter();
        JSONObject jsonObject = JSON.parseObject(parameter);
        Date beginDate = jsonObject.getDate("beginDate");
        Date endDate = jsonObject.getDate("endDate");
        if (beginDate == null || endDate == null) {
            log.info("起始参数为空");
            return;
        }
        while (true) {
            if (!syncSwitch) {
                log.info("同步开关为关闭状态");
                break;
            }
            int offset = (pageNo - 1) * pageSize;
            List<PaymentInvoice> paymentInvoices = paymentInvoiceMapper.queryInvoiceAndInvoiceDate(offset, pageSize, beginDate, endDate);
            if (paymentInvoices == null || paymentInvoices.isEmpty()) {
                log.info("同步invoiceDate的Job执行完成");
                break;
            }
            for (PaymentInvoice paymentInvoice : paymentInvoices) {
                String invoiceNo = paymentInvoice.getInvoiceNo();
                Date invoiceDate = paymentInvoice.getInvoiceDate();
                if (StrUtil.isEmpty(invoiceNo) || invoiceDate == null) {
                    continue;
                }
                log.info("同步的发票信息, invoiceNo:{}, invoiceDate:{}", invoiceNo, invoiceDate);
                paymentInvoiceOrderMapper.updateInvoiceDateByInvoiceNo(invoiceNo, invoiceDate);
            }
            int count = paymentInvoices.size();
            if (count != pageSize) {
                log.info("同步invoiceDate的Job执行完成");
                break;
            } else {
                pageNo++;
            }
        }
    }

}
```

- 为了避免一次更新太多的数据，给数据库带来压力，这里采取分页查询的形式进行更新，同时使用客户端的参数来控制同步的时间段；



### 2.4 分页查询的陷阱，增加查询索引

经过上述的优化后，笔者在生产环境进行测试，发现查询的 RT 并没有降下来，反而从原来的 1.2s 上升到平均 3s，现在这段代码中只存在一个调用查询 Mapper 的方法，考虑到这个 Mapper 查询发票订单表进行的是**分页查询**，消耗的时间不是很多，到生产的数据库验证也的确如此，发现查询的速度在 200ms 左右，究竟是什么导致的呢？

排查后发现，这里使用到了公司提供的分页插件 PageResult，**底层把计算分页 total 数量的查询操作屏蔽掉了**，这是我们分页查询中最容易忽略的地方！



到生产库验证，发现这条 count 查询耗时在 3s 左右，与接口的响应 RT 差不多：

```sql
select count(*) from invoice_order where order_time > '' and order_time < '' and invoice_date > '' and invoice_date < '';
```



目前对于这条 SQL，只存在一个 order_time 的索引，其的执行计划为：

![索引idx_order_time执行计划](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/1708189960531-3fbbf64a-62c4-4a31-bdb9-defd4707410a.png)

- 可见，该查询是走了 order_time 索引，在 extra 字段中出现了 **using index condition** 和 **using where**，表示索引没有完全覆盖查询的字段，通过回表查询后，将完整的数据返回给 server 层，还要在 server 层根据其他查询条件进行过滤；

> using index condition 和 using where 底层的工作原理类似：
>
> 1. server 层调用存储引擎的接口定位到满足非聚簇索引查询条件的第一条二级索引记录；
> 2. 存储引擎根据 B+ 树索引快速定位到这条二级索引记录后，根据该二级索引记录的主键值进行回表操作，将完整的用户记录返回给 server 层；
> 3. server 层在判断其他的搜索条件是否成立，如果成立将其发给客户端，否则跳过改该记录，然后向存储引擎层要下一条记录；
> 4. 由于每条记录都有一个 next_record 属性，根据该属性可以快速找到符合条件的下一条二级索引，然后再执行回表操作，将完整的记录返回给 server 层。然后重复步骤 3；



根据上述的分析可知，该 SQL 先是根据 order_time 进行回表查询，然后将完整记录返回给 server 层，server 层再根据 invoice_date 进行过滤。可见返回给 server 进行判断的这步是十分耗时的。 



所以，笔者接着**创建了 order_time 和 invoice_date 的联合索引**，我们继续查询执行计划：

![索引idx_order_time_invoice_date索引的优化](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/1708190389070-6d9a0c32-1005-42c6-aa63-8e55b7c55823.png)

- 可见，该查询是走了 **idx_order_time_invoice_date** 索引，在 extra 字段中出现了 using index 字段，表示该查询通过二级索引就将数据查询出来了。

> 在 MySQL 8.0.13 后，对 `select count(*) from table_name ` 这条 SQL 做过一定的优化，它会选择一个成本较低的索引。在 InnoDB 中，索引分为聚簇索引和非聚簇索引，前者的叶子节点存储的完整的记录，而后者保存的是该行记录的主键值。相比之下，非聚簇索引比聚簇索引小很多，所以会优先使用最小的非聚簇索引来扫表。



执行完后，count 查询的速度从 3s 降低到 0.2s  ，查询速度提升了 15 倍！这个查询接口的 RT 从原来的 1.2s 降低到 294 ms，可以说性能有了很大的提升。



## 三、优化总结

1. 从代码角度考虑问题，比如是否存在 for 循环中进行 RPC调用，数据库操作等，如果有就可以通过批量查询的方式，提前把数据查出来；
2. 善于使用 explain 执行计划分析 SQL，根据字段 type、key、extra 基本就能判断 SQL 语句是否走索引，其中 extra 字段可以为我们提供更加详细的信息；
3. 建索引时多考虑是否可以建立联合索引来减少回表的操作；