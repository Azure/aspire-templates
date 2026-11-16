using SupportDesk;

var builder = WebApplication.CreateBuilder(args);

// Add service defaults & Aspire client integrations.
builder.AddServiceDefaults();
builder.AddAzureWebPubSubServiceClient("support");

// Add services to the container.
builder.Services.AddProblemDetails();
builder.Services.ConfigureHttpJsonOptions(options => SupportJson.Configure(options.SerializerOptions));
builder.Services.Configure<BrandOptions>(builder.Configuration.GetSection(BrandOptions.SectionName));
builder.Services.AddSingleton<ConversationStore>();
builder.Services.AddSingleton<SupportNotifier>();

// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

var app = builder.Build();

// Configure the HTTP request pipeline.
app.UseExceptionHandler();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

var api = app.MapGroup("/api");
api.MapBrandEndpoints();
api.MapCustomerEndpoints();
api.MapAgentEndpoints();

app.MapWebPubSubEventHandler("/eventhandler");

app.MapDefaultEndpoints();

app.UseFileServer();

app.Run();
