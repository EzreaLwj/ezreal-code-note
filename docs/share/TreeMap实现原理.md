# TreeMap 实现原理



## 一、TreeMap 介绍

TreeMap 的继承图：

![image-20240811120703634](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20240811120703634.png)



- TreeMap 存储键值对，通过红黑树实现；
- TreeMap 实现了 NavigableMap 接口，NavigableMap接口继承了 SortedMap 接口，可支持一系列的导航定位以及导航操作的方法；
- TreeMap 因为是通过红黑树实现，红黑树结构天然支持排序，默认情况下通过 key 值的自然顺序进行排序；



## 二、红黑树原理

红黑树有以下规则：

1. 节点分为红色或者黑色；
2. 根节点必为黑色；
3. 叶子节点都为黑色，且为null；
4. 连接红色节点的两个子节点都为黑色（红黑树不会出现相邻的红色节点）；
5. 从任意节点出发，到其每个叶子节点的路径中包含相同数量的黑色节点；
6. 新加入到红黑树的节点为红色节点；



## 三、TreeMap 实现原理

TreeMap 中 Entry 的实现：

```java
static final class Entry<K,V> implements Map.Entry<K,V> {
    K key;
    V value;
    Entry<K,V> left;
    Entry<K,V> right;
    Entry<K,V> parent;
    boolean color = BLACK;

    Entry(K key, V value, Entry<K,V> parent) {
        this.key = key;
        this.value = value;
        this.parent = parent;
    }
    public K getKey() {
        return key;
    }
    public V getValue() {
        return value;
    }
    public V setValue(V value) {
        V oldValue = this.value;
        this.value = value;
        return oldValue;
    }
    public boolean equals(Object o) {
        if (!(o instanceof Map.Entry))
            return false;
        Map.Entry<?,?> e = (Map.Entry<?,?>)o;

        return valEquals(key,e.getKey()) && valEquals(value,e.getValue());
    }
    public int hashCode() {
        int keyHash = (key==null ? 0 : key.hashCode());
        int valueHash = (value==null ? 0 : value.hashCode());
        return keyHash ^ valueHash;
    }
    public String toString() {
        return key + "=" + value;
    }
}
```

- 其中包含 left、right 和 parent，分别代表三个指针，指向左节点、右节点和父节点，通过父节点可以快速找到引用字节的节点；



TreeMap 中的 put 方法：

```java
public V put(K key, V value) {
    Entry<K,V> t = root;
    //如果root节点为空，就创建root节点
    if (t == null) {
        compare(key, key); // type (and possibly null) check
        root = new Entry<>(key, value, null);
        size = 1;
        modCount++;
        return null;
    }
    int cmp;
    Entry<K,V> parent;
    // split comparator and comparable paths
    Comparator<? super K> cpr = comparator;
    if (cpr != null) {
        //循环，不断找到需要父节点的位置
        //这里是通过comparator进行排序，key值可以为空，应当考虑key为null的情况
        //其实是二分查找
        do {
            parent = t;
            cmp = cpr.compare(key, t.key);
           	// 如果比当前的key小，就放到左节点
            if (cmp < 0)
                t = t.left;
            // 如果比当前的key大，就放到右节点
            else if (cmp > 0)
                t = t.right;
            else
                return t.setValue(value);
        } while (t != null);
    }
    else {
        //这里是默认排序，即通过key的值进行排序，key不能为空
        if (key == null)
            throw new NullPointerException();
        @SuppressWarnings("unchecked")
            Comparable<? super K> k = (Comparable<? super K>) key;
        do {
            parent = t;
            cmp = k.compareTo(t.key);
            if (cmp < 0)
                t = t.left;
            else if (cmp > 0)
                t = t.right;
            else
                return t.setValue(value);
        } while (t != null);
    }
    // 找到父节点后，根据key，value和parent创建entry对象
    Entry<K,V> e = new Entry<>(key, value, parent);
    if (cmp < 0)
        parent.left = e;
    else
        parent.right = e;
    //插入后继续调整红黑树的结构
    fixAfterInsertion(e);
    size++;
    modCount++;
    return null;
}
```

- 当插入完毕后，要调整红黑树的结构，即调用 fixAfterInsertion 方法；



TreeMap 的 get 方法：

```java
public V get(Object key) {
    Entry<K,V> p = getEntry(key);
    return (p==null ? null : p.value);
}
//无论是通过key的默认排序还是通过比较器排序
//都是统一的算法：如果小于当前key就走当前节点的左子树，否则走右子树
final Entry<K,V> getEntry(Object key) {
    // Offload comparator-based version for sake of performance
    if (comparator != null)
        return getEntryUsingComparator(key);
    if (key == null)
        throw new NullPointerException();
    //使用key的进行默认排序
    @SuppressWarnings("unchecked")
        Comparable<? super K> k = (Comparable<? super K>) key;
    Entry<K,V> p = root;
    while (p != null) {
        int cmp = k.compareTo(p.key);
        if (cmp < 0)
            p = p.left;
        else if (cmp > 0)
            p = p.right;
        else
            return p;
    }
    return null;
}
//使用比较器进行排序
final Entry<K,V> getEntryUsingComparator(Object key) {
    @SuppressWarnings("unchecked")
        K k = (K) key;
    Comparator<? super K> cpr = comparator;
    if (cpr != null) {
        Entry<K,V> p = root;
        while (p != null) {
            int cmp = cpr.compare(k, p.key);
            if (cmp < 0)
                p = p.left;
            else if (cmp > 0)
                p = p.right;
            else
                return p;
        }
    }
    return null;
}
```

