package com.proptit.guestbook.info;

import com.proptit.guestbook.message.MessageRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.net.InetAddress;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Trả về thông tin giúp "nhìn thấy" những gì đã học khi deploy:
 * - app: phiên bản (biến môi trường APP_VERSION), profile, hostname (= Container ID khi chạy trong Docker)
 * - client: IP và giao thức của người dùng mà backend nhìn thấy (nhờ header X-Forwarded-* từ Nginx)
 * - database: ứng dụng có kết nối được database qua mạng nội bộ Docker (db:3306) không
 */
@RestController
public class InfoController {

    private final DataSource dataSource;
    private final MessageRepository repository;
    private final Environment environment;
    private final String version;

    public InfoController(DataSource dataSource,
                          MessageRepository repository,
                          Environment environment,
                          @Value("${app.version}") String version) {
        this.dataSource = dataSource;
        this.repository = repository;
        this.environment = environment;
        this.version = version;
    }

    @GetMapping("/api/info")
    public Map<String, Object> info(HttpServletRequest request) {
        Map<String, Object> app = new LinkedHashMap<>();
        app.put("version", version);
        // Không khai báo SPRING_PROFILES_ACTIVE thì Spring dùng profile mặc định (spring.profiles.default=dev)
        String[] profiles = environment.getActiveProfiles();
        app.put("profiles", profiles.length > 0 ? profiles : environment.getDefaultProfiles());
        app.put("hostname", hostname());
        app.put("javaVersion", System.getProperty("java.version"));
        app.put("serverTime", OffsetDateTime.now().toString());

        // Với server.forward-headers-strategy=framework, Spring đọc X-Forwarded-For / X-Forwarded-Proto
        // nên getRemoteAddr() là IP thật của người dùng, getScheme() là http hoặc https gốc.
        // Nếu thiếu cấu hình này, backend chỉ thấy IP của Nginx (172.x.x.x) và luôn là "http".
        Map<String, Object> client = new LinkedHashMap<>();
        client.put("ip", request.getRemoteAddr());
        client.put("scheme", request.getScheme());
        client.put("host", request.getServerName());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("app", app);
        result.put("client", client);
        result.put("database", database());
        return result;
    }

    private Map<String, Object> database() {
        Map<String, Object> db = new LinkedHashMap<>();
        try (Connection connection = dataSource.getConnection()) {
            DatabaseMetaData meta = connection.getMetaData();
            db.put("status", "UP");
            db.put("product", meta.getDatabaseProductName() + " " + meta.getDatabaseProductVersion());
            db.put("url", meta.getURL());
            db.put("messages", repository.count());
        } catch (Exception e) {
            db.put("status", "DOWN");
            db.put("error", e.getMessage());
        }
        return db;
    }

    private static String hostname() {
        try {
            return InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            return "unknown";
        }
    }
}
