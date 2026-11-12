# HSK 词语工作台

输入词语可查询 HSK 等级。粘贴文本后点击「分词并标记」，即可按 HSK 1–6 级标色。点击词语可以查看等级，结果保留原文的标点和换行。

查词和分词在浏览器内运行。词表包含 5,334 个词。此 GitHub Pages 版本提供词语查询和全文分级。AI 近义词功能需要能调用模型的服务端。

在仓库的 Settings → Pages 中选择 Deploy from a branch，分支选择 main，目录选择 /docs，然后保存。

分词使用 Jieba 0.42.1 的词频词典和 HMM 参数，许可见 [Jieba MIT License](./LICENSE-jieba.txt)。HSK 等级来自用户提供的 HSKDictionary0830.xlsx。
