# Frontend là HTML/CSS/JS tĩnh, không cần build -> chỉ cần một Nginx nhỏ để phục vụ file
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/

EXPOSE 80
