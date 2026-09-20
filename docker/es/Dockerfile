FROM docker.elastic.co/elasticsearch/elasticsearch:8.18.0
# IK 插件版本必须与镜像 tag 逐字一致；get.infini.cloud 是 infinilabs（IK 官方）插件分发地址，
# 网络不畅时可替换为 GitHub releases 的 zip 地址：
# https://github.com/infinilabs/analysis-ik/releases/download/v8.18.0/elasticsearch-analysis-ik-8.18.0.zip
RUN elasticsearch-plugin install --batch https://get.infini.cloud/elasticsearch/analysis-ik/8.18.0
