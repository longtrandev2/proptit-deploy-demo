# ===== Stage 1: Build =====
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app

# Copy pom.xml trước để tận dụng cache layer:
# dependency chỉ tải lại khi pom.xml thay đổi, không phải mỗi lần sửa code
COPY pom.xml .
RUN mvn dependency:go-offline -B

COPY src ./src
RUN mvn clean package -DskipTests -B

# ===== Stage 2: Runtime =====
# Image cuối chỉ có JRE + file jar (~250MB), không có Maven, JDK, mã nguồn
FROM eclipse-temurin:21-jre
WORKDIR /app

# Chạy bằng user thường thay vì root để giảm rủi ro bảo mật
RUN groupadd --system spring && useradd --system --gid spring spring
USER spring

COPY --from=build /app/target/*.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
