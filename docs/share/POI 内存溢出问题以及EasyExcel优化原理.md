# POI 内存溢出问题

## 背景

Apache POI，是一个处理文档的工具，我们通常会使用其来处理 Excel 文件，但是可能会遇到内存溢出的情况，有以下两原因：

### Excel 文件的实质

我们通常见到的 xlsx 文件，其实是一个个的压缩文件，它们把若干个 XML 格式的纯文本文件压缩在一起，Excel 就是读取这些压缩文件的信息，最后展示出一个电子表格。



![xlsx解压缩后的文件](https://ezreal-tuchuang-1312880100.cos.ap-guangzhou.myqcloud.com/article/image-20231226010311303.png)

- rels 文件夹：配置数据的基本信息；
- docProps 文件夹：存放 sheet 信息，最重要的文件是 app.xml
- xl 文件夹：存放每一个 sheet 的数据；

所以，实际上我们处理的 xlsx 文件实际上是经过高度压缩的文件格式，背后有好多文件支持的。所以，我们看到的一个文件只有 2M，但在实际上这个文件未压缩的情况可能比 2M 要大得多。



### POI 溢出原理

POI 写入 Excel 

```java
public static void main(String[] args) {
    String filename = "example.xlsx";

    try (FileInputStream fileInputStream = new FileInputStream(filename)) {
        Workbook workbook = new XSSFWorkbook(fileInputStream);
        Sheet sheet = workbook.getSheetAt(0);
        for (Row row : sheet) {
            for (Cell cell : row) {
                switch (cell.getCellTypeEnum()) {
                    case STRING:
                        System.out.println(cell.getStringCellValue());
                        break;
                    case NUMERIC:
                        if (org.apache.poi.ss.usermodel.DateUtil.isCellDateFormatted(cell)) {
                            System.out.println(cell.getDateCellValue());
                        } else {
                            System.out.println(cell.getNumericCellValue());
                        }
                        break;
                    case BOOLEAN:
                        System.out.println(cell.getBooleanCellValue());
                        break;
                    default:
                        System.out.println(" ");
                }
            }
        }
    } catch (Exception e) {
        e.printStackTrace();
    }
}
```



在  XSSFWorkbook 的构造函数中，有一个 open 方法

```java
public XSSFWorkbook(File file) throws IOException, InvalidFormatException {
    this(OPCPackage.open(file));
}
```

该方法会把文件直接读入内存中：

```java
/**
 * Open a package.
 *
 * Note - uses quite a bit more memory than {@link #open(String)}, which
 * doesn't need to hold the whole zip file in memory, and can take advantage
 * of native methods
 *
 * @param in
 *            The InputStream to read the package from
 * @return A PackageBase object
 */
public static OPCPackage open(InputStream in) throws InvalidFormatException,
        IOException {
    OPCPackage pack = new ZipPackage(in, PackageAccess.READ_WRITE);
    try {
        if (pack.partList == null) {
            pack.getParts();
        }
    } catch (InvalidFormatException e) {
        IOUtils.closeQuietly(pack);
        throw e;
    } catch (RuntimeException e) {
        IOUtils.closeQuietly(pack);
        throw e;
    }
    return pack;
}
```

- 注释中说明会把所有的压缩文件读入到内存中，可想而知读入大文件时会内存溢出；



**POI 中几种 Workbook 格式**

**SSFWorkbook**：用于处理 Excel 的 .xls 格式；

**XSSFWorkbook**：用于处理 Excel 的 .xlsx 格式。支持更大的数据集和更多功能，但是相对于 HSSWorkbook，它在处理大数据集时可能占用更大的内存；

**SXSSFWorkbook**：用于处理 Excel 的 .xlsx 格式。专门用于处理大数据集，通过将数据写入临时文件而非全部保存在内存中，显著减少内存消耗，适用于创建大型的数据集的 Excel 文件
